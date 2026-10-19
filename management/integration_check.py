"""Run ONLY against disposable Compose project origrami-admin-check.

docker run --rm --network origrami-admin-check_backend --entrypoint python
  --mount type=bind,source=<project>/management,target=/project,readonly
  -e ORIGRAMI_DISPOSABLE_TEST=origrami-admin-check matrixdotorg/synapse:v1.163.0
  -B /project/integration_check.py

Uses alice/alice and bob/bob; creates, promotes and deactivates a disposable user.
"""
import json
import os
import secrets
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def call(base, method, path, body=None, token=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = Request(base + path, method=method, headers=headers,
                      data=json.dumps(body).encode() if body is not None else None)
    try:
        response = urlopen(request, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        result = json.load(response)
        assert response.code == expected, (method, path, response.code, result.get('error'))
        return result


def main():
    if os.environ.get('ORIGRAMI_DISPOSABLE_TEST') != 'origrami-admin-check':
        raise SystemExit('Refusing to run outside the explicitly designated disposable test.')
    api = 'http://management:8090'
    matrix = 'http://synapse:8008'
    def login(username, password):
        return call(matrix, 'POST', '/_matrix/client/v3/login', {
            'type': 'm.login.password',
            'identifier': {'type': 'm.id.user', 'user': username}, 'password': password,
        })['access_token']
    alice = login('alice', 'alice')
    bob = login('bob', 'bob')
    applicant_token = None
    try:
        assert call(api, 'GET', '/api/me', token=alice)['role'] == 'superuser'
        assert call(api, 'GET', '/api/me', token=bob)['role'] == 'user'
        call(api, 'GET', '/api/admin/overview', token=bob, expected=403)
        # Human management roles must not grant Synapse's unrestricted API.
        call(matrix, 'GET', '/_synapse/admin/v2/users?limit=1', token=alice, expected=403)
        username = 'check-' + secrets.token_hex(4)
        request = call(api, 'POST', '/api/registration', {'username': username, 'display_name': 'Integration Applicant'})
        listing = call(api, 'GET', '/api/admin/requests?q=' + username, token=alice)
        assert listing['total'] == 1
        call(api, 'POST', '/api/admin/requests/decide', {'ids': [request['request_id']], 'decision': 'accepted'}, alice)
        assert call(api, 'GET', '/api/registration', token=request['claim_token'])['status'] == 'accepted'
        password = secrets.token_urlsafe(24)
        call(api, 'POST', '/api/registration/activate', {'password': password}, request['claim_token'])
        applicant_token = login(username, password)
        uid = '@' + username + ':localhost'
        users = call(api, 'GET', '/api/admin/users?q=' + username, token=alice)['items']
        assert users[0]['display_name'] == 'Integration Applicant'
        call(api, 'POST', '/api/admin/users/action', {'user_id': uid, 'action': 'promote'}, alice)
        assert call(api, 'GET', '/api/me', token=applicant_token)['role'] == 'admin'
        call(api, 'GET', '/api/admin/metrics', token=applicant_token, expected=403)
        call(api, 'POST', '/api/admin/users/action', {'user_id': '@alice:localhost', 'action': 'deactivate'}, applicant_token, expected=403)
        call(api, 'POST', '/api/admin/settings', {'admins_view_metrics': True}, alice)
        assert call(api, 'GET', '/api/admin/metrics', token=applicant_token)['cpu_percent'] is not None
        call(api, 'POST', '/api/admin/settings', {'admins_view_metrics': False}, alice)
        call(api, 'GET', '/api/admin/metrics', token=applicant_token, expected=403)
        call(api, 'POST', '/api/admin/users/action', {'user_id': uid, 'action': 'demote'}, alice)
        call(api, 'GET', '/api/admin/overview', token=applicant_token, expected=403)
        call(api, 'POST', '/api/admin/users/action', {'user_id': uid, 'action': 'deactivate'}, alice)
        call(api, 'GET', '/api/me', token=applicant_token, expected=401)
        applicant_token = None
        blocked = 'blocked-' + secrets.token_hex(4)
        call(api, 'POST', '/api/admin/blocklist', {'username': blocked}, alice)
        call(api, 'POST', '/api/registration', {'username': blocked, 'display_name': 'Blocked'}, expected=403)
        print('PASS: live registration, approval, activation, display name, roles, superuser protection, metrics grant/revocation, demotion, deactivation, native-API denial and blocklist.')
    finally:
        for token in (alice, bob, applicant_token):
            if token:
                call(matrix, 'POST', '/_matrix/client/v3/logout', {}, token)


if __name__ == '__main__':
    main()
