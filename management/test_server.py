"""Security and workflow tests; no Docker, dependencies or real accounts required."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from server import APIError, Management


class FakeMatrix:
    def __init__(self):
        self.users = {
            '@alice:localhost': {'name': '@alice:localhost', 'displayname': 'Alice'},
            '@bob:localhost': {'name': '@bob:localhost', 'displayname': 'Bob'},
            '@eve:localhost': {'name': '@eve:localhost', 'displayname': 'Eve'},
            '@origrami.management:localhost': {'name': '@origrami.management:localhost', 'admin': True},
        }
        self.tokens = {name: '@' + name + ':localhost' for name in ('alice', 'bob', 'eve')}
        self.calls = []

    def call(self, method, path, body=None, token=None):
        self.calls.append((method, path, body))
        if path == '/_matrix/client/v3/logout':
            return {}
        if token not in self.tokens:
            raise APIError(401, 'Invalid session')
        return {'user_id': self.tokens[token]}

    def admin(self, method, path, body=None):
        from urllib.parse import unquote
        self.calls.append((method, path, body))
        if path.startswith('/v2/users?'):
            return {'users': list(self.users.values()), 'total': len(self.users)}
        user_id = unquote(path.split('/')[-1])
        if user_id not in self.users:
            raise APIError(404, 'No user')
        if path.startswith('/v1/deactivate/'):
            self.users[user_id]['deactivated'] = True
            self.tokens = {token: user for token, user in self.tokens.items() if user != user_id}
            return {}
        return self.users[user_id]

    def register(self, username, password, admin=False, display_name=None):
        uid = '@' + username + ':localhost'
        if uid in self.users:
            raise APIError(400, 'Existing account', 'M_USER_IN_USE')
        self.users[uid] = {'name': uid, 'admin': admin, 'displayname': display_name}
        return {'user_id': uid, 'access_token': 'temporary-registration-token'}


class ManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.matrix = FakeMatrix()
        self.app = Management(Path(self.temp.name) / 'management.sqlite3', self.matrix, ['@alice:localhost'])

    def call(self, actor, method, path, body=None, query=None):
        return self.app.handle(method, path, query or {}, body or {}, actor)

    def admin(self, name='bob'):
        self.call('alice', 'POST', '/api/admin/users/action', {'user_id': '@' + name + ':localhost', 'action': 'promote'})

    def request(self, username='charlie', source='local'):
        return self.app.handle('POST', '/api/registration', {}, {'username': username, 'display_name': username.title()}, '', source)

    def assertDenied(self, actor, method, path, body=None):
        with self.assertRaises(APIError) as error:
            self.call(actor, method, path, body)
        self.assertEqual(error.exception.status, 403)

    def test_normal_users_cannot_read_or_mutate_management(self):
        self.assertEqual(self.call('bob', 'GET', '/api/me')['role'], 'user')
        for path in ('overview', 'users', 'requests', 'blocklist', 'audit', 'metrics'):
            self.assertDenied('bob', 'GET', '/api/admin/' + path)
        self.assertDenied('bob', 'POST', '/api/admin/users/action', {'user_id': '@eve:localhost', 'action': 'promote'})

    def test_metrics_default_private_grant_and_revoke_on_server(self):
        self.admin()
        self.assertFalse(self.call('bob', 'GET', '/api/me')['can_view_metrics'])
        self.assertDenied('bob', 'GET', '/api/admin/metrics')
        self.assertDenied('bob', 'POST', '/api/admin/settings', {'admins_view_metrics': True})
        with patch('server.system_metrics', return_value={'cpu_percent': 12}) as metrics:
            self.assertEqual(self.call('alice', 'GET', '/api/admin/metrics')['cpu_percent'], 12)
            self.call('alice', 'POST', '/api/admin/settings', {'admins_view_metrics': True})
            self.assertTrue(self.call('bob', 'GET', '/api/me')['can_view_metrics'])
            self.call('bob', 'GET', '/api/admin/metrics')
            self.call('alice', 'POST', '/api/admin/settings', {'admins_view_metrics': False})
            self.assertDenied('bob', 'GET', '/api/admin/metrics')
            self.assertEqual(metrics.call_count, 2)

    def test_superuser_and_system_account_protected_for_every_action(self):
        self.admin()
        for actor in ('alice', 'bob'):
            for target in ('@alice:localhost', '@origrami.management:localhost'):
                for action in ('promote', 'demote', 'deactivate'):
                    self.assertDenied(actor, 'POST', '/api/admin/users/action', {'user_id': target, 'action': action})
        with self.assertRaises(APIError):
            self.call('alice', 'POST', '/api/admin/blocklist', {'username': 'alice'})

    def test_admin_can_promote_but_only_superuser_can_demote_peers(self):
        self.admin()
        self.call('bob', 'POST', '/api/admin/users/action', {'user_id': '@eve:localhost', 'action': 'promote'})
        for action in ('demote', 'deactivate'):
            self.assertDenied('bob', 'POST', '/api/admin/users/action', {'user_id': '@eve:localhost', 'action': action})
        self.call('alice', 'POST', '/api/admin/users/action', {'user_id': '@eve:localhost', 'action': 'demote'})
        self.assertEqual(self.call('eve', 'GET', '/api/me')['role'], 'user')
        self.assertFalse(self.matrix.users['@eve:localhost'].get('admin', False))

    def test_demotion_immediately_revokes_existing_session_management_rights(self):
        self.admin()
        self.call('alice', 'POST', '/api/admin/users/action', {'user_id': '@bob:localhost', 'action': 'demote'})
        self.assertDenied('bob', 'GET', '/api/admin/overview')
        self.assertEqual(self.call('bob', 'GET', '/api/me')['role'], 'user')

    def test_kick_deactivates_user_and_revokes_token_and_role(self):
        self.admin()
        self.call('alice', 'POST', '/api/admin/users/action', {'user_id': '@bob:localhost', 'action': 'deactivate'})
        self.assertTrue(self.matrix.users['@bob:localhost']['deactivated'])
        with self.assertRaises(APIError) as error:
            self.call('bob', 'GET', '/api/me')
        self.assertEqual(error.exception.status, 401)

    def test_native_admins_are_not_touched_and_user_list_is_allowlisted(self):
        self.admin()
        self.matrix.users['@eve:localhost'].update(admin=True, access_token='secret', email='secret', avatar_url='private-media')
        self.assertDenied('alice', 'POST', '/api/admin/users/action', {'user_id': '@eve:localhost', 'action': 'deactivate'})
        result = self.call('bob', 'GET', '/api/admin/users')
        encoded = json.dumps(result)
        for secret in ('secret', 'private-media', 'origrami.management', 'avatar_url'):
            self.assertNotIn(secret, encoded)

    def test_no_content_or_impersonation_api_exists(self):
        for path in ('rooms', 'messages', 'media', 'devices', 'login', 'impersonate'):
            with self.assertRaises(APIError) as error:
                self.call('alice', 'GET', '/api/admin/' + path)
            self.assertEqual(error.exception.status, 404)

    def test_request_approval_claim_and_activation_without_storing_password(self):
        receipt = self.request()
        self.assertNotIn('@charlie:localhost', self.matrix.users)
        with self.assertRaises(APIError):
            self.call(receipt['claim_token'], 'POST', '/api/registration/activate', {'password': 'a-long-test-password'})
        self.call('alice', 'POST', '/api/admin/requests/decide', {'decision': 'accepted', 'ids': [receipt['request_id']]})
        self.assertEqual(self.call(receipt['claim_token'], 'GET', '/api/registration')['status'], 'accepted')
        self.call(receipt['claim_token'], 'POST', '/api/registration/activate', {'password': 'a-long-test-password'})
        self.assertFalse(self.matrix.users['@charlie:localhost']['admin'])
        self.assertEqual(self.call(receipt['claim_token'], 'GET', '/api/registration')['status'], 'activated')
        self.assertNotIn(b'a-long-test-password', Path(self.app.database).read_bytes())
        self.assertNotIn(receipt['claim_token'].encode(), Path(self.app.database).read_bytes())
        with self.assertRaises(APIError):
            self.call('wrong-receipt', 'GET', '/api/registration')

    def test_approval_cannot_overwrite_an_existing_account(self):
        with self.assertRaises(APIError):
            self.request('bob')
        receipt = self.request('charlie')
        # Another provisioning path wins the username after the request.
        self.matrix.users['@charlie:localhost'] = {'name': '@charlie:localhost', 'displayname': 'Original'}
        self.call('alice', 'POST', '/api/admin/requests/decide', {'decision': 'accepted', 'ids': [receipt['request_id']]})
        with self.assertRaises(APIError) as error:
            self.call(receipt['claim_token'], 'POST', '/api/registration/activate', {'password': 'do-not-replace-password'})
        self.assertEqual(error.exception.code, 'M_USER_IN_USE')
        self.assertEqual(self.matrix.users['@charlie:localhost']['displayname'], 'Original')

    def test_bulk_search_and_cutoff_do_not_approve_later_or_nonmatching_requests(self):
        first = self.request('charlie')
        other = self.request('david')
        listing = self.call('alice', 'GET', '/api/admin/requests', query={'q': ['char']})
        late = self.request('charlotte')
        result = self.call('alice', 'POST', '/api/admin/requests/decide', {'all': True, 'cutoff': listing['cutoff'], 'q': 'char', 'decision': 'accepted'})
        self.assertEqual(result['changed'], 1)
        for receipt, status in ((first, 'accepted'), (other, 'pending'), (late, 'pending')):
            self.assertEqual(self.call(receipt['claim_token'], 'GET', '/api/registration')['status'], status)
        self.assertEqual(self.call('alice', 'GET', '/api/admin/requests', query={'q': ["%' OR 1=1 --"]})['total'], 0)

    def test_blocklist_rejects_requests_and_prevents_activation(self):
        self.admin()
        receipt = self.request()
        self.call('bob', 'POST', '/api/admin/requests/decide', {'decision': 'accepted', 'ids': [receipt['request_id']]})
        self.call('bob', 'POST', '/api/admin/blocklist', {'username': 'charlie'})
        self.assertEqual(self.call(receipt['claim_token'], 'GET', '/api/registration')['status'], 'rejected')
        with self.assertRaises(APIError):
            self.request('charlie')
        with self.assertRaises(APIError):
            self.call(receipt['claim_token'], 'POST', '/api/registration/activate', {'password': 'a-long-test-password'})
        self.call('bob', 'DELETE', '/api/admin/blocklist', {'username': 'charlie'})
        self.request('charlie')

    def test_rate_limiting_duplicate_requests_reserved_names_and_persistence(self):
        with self.assertRaises(APIError):
            self.request('alice')
        self.request('charlie')
        with self.assertRaises(APIError):
            self.request('charlie')
        for i in range(7):
            self.request('bot' + str(i))
        with self.assertRaises(APIError) as error:
            self.request('too-many')
        self.assertEqual(error.exception.status, 429)
        self.admin()
        reopened = Management(self.app.database, self.matrix, ['@alice:localhost'])
        self.assertEqual(reopened.handle('GET', '/api/me', {}, {}, 'bob')['role'], 'admin')

    def test_audit_has_actor_and_target_without_tokens_or_passwords(self):
        self.admin()
        self.call('alice', 'POST', '/api/admin/settings', {'admins_view_metrics': True})
        rows = self.call('alice', 'GET', '/api/admin/audit')['items']
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]['target'], '@bob:localhost')
        self.assertTrue(all(row['actor'] == '@alice:localhost' for row in rows))

    def test_activation_stays_recorded_when_optional_logout_fails(self):
        receipt = self.request()
        self.call('alice', 'POST', '/api/admin/requests/decide', {'decision': 'accepted', 'ids': [receipt['request_id']]})
        original = self.matrix.call
        def fail_logout(method, path, body=None, token=None):
            if path.endswith('/logout'):
                raise APIError(503, 'Temporary outage')
            return original(method, path, body, token)
        with patch.object(self.matrix, 'call', side_effect=fail_logout):
            self.call(receipt['claim_token'], 'POST', '/api/registration/activate', {'password': 'a-long-test-password'})
        self.assertEqual(self.call(receipt['claim_token'], 'GET', '/api/registration')['status'], 'activated')

    def test_bulk_rejection_cannot_change_already_accepted_requests(self):
        first, second = self.request('first'), self.request('second')
        self.call('alice', 'POST', '/api/admin/requests/decide', {'decision': 'accepted', 'ids': [first['request_id']]})
        listing = self.call('alice', 'GET', '/api/admin/requests')
        result = self.call('alice', 'POST', '/api/admin/requests/decide', {'decision': 'rejected', 'all': True, 'q': '', 'cutoff': listing['cutoff']})
        self.assertEqual(result['changed'], 1)
        self.assertEqual(self.call(first['claim_token'], 'GET', '/api/registration')['status'], 'accepted')
        self.assertEqual(self.call(second['claim_token'], 'GET', '/api/registration')['status'], 'rejected')


if __name__ == '__main__':
    unittest.main()
