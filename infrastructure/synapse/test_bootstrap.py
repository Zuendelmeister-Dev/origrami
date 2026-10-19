"""Run inside the Synapse image: python -m unittest discover -s /project/infrastructure/synapse."""
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

import yaml
import bootstrap


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for name, value in {'DATA': root, 'CONFIG': root / 'homeserver.yaml',
                            'SQLITE': root / 'homeserver.db', 'MEDIA': root / 'media_store'}.items():
            patcher = patch.object(bootstrap, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.dict(os.environ, {'ORIGRAMI_DB_PASSWORD': 'test-only-password'})
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, config):
        bootstrap.CONFIG.write_text(yaml.safe_dump(config), encoding='utf-8')

    def test_existing_postgres_keeps_secrets_and_is_idempotent(self):
        self.write({'database': bootstrap.database_settings(), 'registration_shared_secret': 'preserve-me',
                    'signing_key_path': '/data/existing.signing.key'})
        self.assertEqual(bootstrap.main(), 0)
        first = bootstrap.CONFIG.read_bytes()
        config = yaml.safe_load(first)
        self.assertEqual(config['registration_shared_secret'], 'preserve-me')
        self.assertEqual(config['signing_key_path'], '/data/existing.signing.key')
        self.assertFalse(config['enable_registration'])
        self.assertEqual(config['federation_domain_whitelist'], [])
        self.assertEqual(config['listeners'][0]['resources'][0]['names'], ['client'])
        self.assertEqual(bootstrap.main(), 0)
        self.assertEqual(bootstrap.CONFIG.read_bytes(), first)

    def test_credential_mismatch_does_not_modify_config(self):
        config = {'database': bootstrap.database_settings()}
        config['database']['args']['password'] = 'old-password'
        self.write(config)
        before = bootstrap.CONFIG.read_bytes()
        self.assertEqual(bootstrap.main(), 4)
        self.assertEqual(bootstrap.CONFIG.read_bytes(), before)

    def test_existing_sqlite_is_not_replaced(self):
        self.write({'database': {'name': 'sqlite3'}})
        bootstrap.SQLITE.write_bytes(b'existing database')
        before = bootstrap.CONFIG.read_bytes()
        self.assertEqual(bootstrap.main(), 3)
        self.assertEqual(bootstrap.CONFIG.read_bytes(), before)

    def test_custom_sqlite_path_is_not_replaced(self):
        custom = bootstrap.DATA / 'private-history.sqlite'
        custom.write_bytes(b'existing custom database')
        self.write({'database': {'name': 'sqlite3', 'args': {'database': str(custom)}}})
        before = bootstrap.CONFIG.read_bytes()
        self.assertEqual(bootstrap.main(), 3)
        self.assertEqual(bootstrap.CONFIG.read_bytes(), before)
        self.assertEqual(custom.read_bytes(), b'existing custom database')
        self.assertFalse(bootstrap.MEDIA.exists())

    def test_missing_sqlite_mount_is_not_treated_as_empty_installation(self):
        self.write({'database': {'name': 'sqlite3', 'args': {'database': '/unmounted/history.db'}}})
        before = bootstrap.CONFIG.read_bytes()
        self.assertEqual(bootstrap.main(), 3)
        self.assertEqual(bootstrap.CONFIG.read_bytes(), before)

    def test_other_existing_database_engine_is_not_replaced(self):
        self.write({'database': {'name': 'custom-engine'}})
        before = bootstrap.CONFIG.read_bytes()
        self.assertEqual(bootstrap.main(), 3)
        self.assertEqual(bootstrap.CONFIG.read_bytes(), before)

    def test_fresh_generated_config_uses_postgres(self):
        def generate(*args, **kwargs):
            self.write({'database': {'name': 'sqlite3', 'args': {'database': str(bootstrap.SQLITE)}},
                        'media_store_path': str(bootstrap.MEDIA),
                        'registration_shared_secret': 'new-generated-secret'})

        with patch.object(bootstrap.subprocess, 'run', side_effect=generate) as run:
            self.assertEqual(bootstrap.main(), 0)
        run.assert_called_once()
        config = yaml.safe_load(bootstrap.CONFIG.read_text(encoding='utf-8'))
        self.assertEqual(config['database'], bootstrap.database_settings())
        self.assertEqual(config['registration_shared_secret'], 'new-generated-secret')
        self.assertFalse(config['enable_registration'])

    def test_custom_existing_media_path_is_not_replaced(self):
        custom = bootstrap.DATA / 'private-media'
        custom.mkdir()
        media = custom / 'encrypted-upload'
        media.write_bytes(b'existing encrypted media')
        self.write({'database': bootstrap.database_settings(), 'media_store_path': str(custom)})
        before = bootstrap.CONFIG.read_bytes()
        self.assertEqual(bootstrap.main(), 5)
        self.assertEqual(bootstrap.CONFIG.read_bytes(), before)
        self.assertEqual(media.read_bytes(), b'existing encrypted media')
        self.assertFalse(bootstrap.MEDIA.exists())

    def test_missing_custom_media_mount_is_not_treated_as_empty(self):
        self.write({'database': bootstrap.database_settings(),
                    'media_store_path': '/unmounted/private-media'})
        before = bootstrap.CONFIG.read_bytes()
        self.assertEqual(bootstrap.main(), 5)
        self.assertEqual(bootstrap.CONFIG.read_bytes(), before)
        self.assertFalse(bootstrap.MEDIA.exists())

    def test_config_temp_is_private_before_secrets_are_written(self):
        original_dump = bootstrap.yaml.safe_dump

        def check_permissions(config, stream, **kwargs):
            self.assertEqual(stat.S_IMODE(os.fstat(stream.fileno()).st_mode), 0o600)
            return original_dump(config, stream, **kwargs)

        previous_umask = os.umask(0)
        try:
            with patch.object(bootstrap.yaml, 'safe_dump', side_effect=check_permissions):
                bootstrap.dump_config({'registration_shared_secret': 'private-secret'})
        finally:
            os.umask(previous_umask)
        self.assertEqual(stat.S_IMODE(bootstrap.CONFIG.stat().st_mode), 0o600)
        self.assertEqual(list(bootstrap.DATA.glob('.*.tmp')), [])

    def test_failed_config_write_preserves_original_and_removes_temp(self):
        self.write({'registration_shared_secret': 'keep-original'})
        before = bootstrap.CONFIG.read_bytes()

        def fail_after_writing(config, stream, **kwargs):
            stream.write('registration_shared_secret: partial-private-secret')
            raise RuntimeError('serialization failed')

        with patch.object(bootstrap.yaml, 'safe_dump', side_effect=fail_after_writing):
            with self.assertRaisesRegex(RuntimeError, 'serialization failed'):
                bootstrap.dump_config({'registration_shared_secret': 'new-secret'})
        self.assertEqual(bootstrap.CONFIG.read_bytes(), before)
        self.assertEqual(list(bootstrap.DATA.glob('.*.tmp')), [])

    def test_predictable_old_temp_path_is_not_used(self):
        old_temp = bootstrap.CONFIG.with_suffix('.yaml.tmp')
        old_temp.write_bytes(b'leave-existing-file-alone')
        bootstrap.dump_config({'registration_shared_secret': 'new-secret'})
        self.assertEqual(old_temp.read_bytes(), b'leave-existing-file-alone')

    def test_lingering_default_sqlite_is_not_replaced_without_config(self):
        bootstrap.SQLITE.write_bytes(b'orphaned existing database')

        def generate(*args, **kwargs):
            self.write({'database': {'name': 'sqlite3'}})

        with patch.object(bootstrap.subprocess, 'run', side_effect=generate):
            self.assertEqual(bootstrap.main(), 3)
        config = yaml.safe_load(bootstrap.CONFIG.read_text(encoding='utf-8'))
        self.assertEqual(config['database']['name'], 'sqlite3')
        self.assertEqual(bootstrap.SQLITE.read_bytes(), b'orphaned existing database')

    def test_invalid_password_does_not_generate_config(self):
        with patch.dict(os.environ, {'ORIGRAMI_DB_PASSWORD': 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD'}):
            with patch.object(bootstrap.subprocess, 'run') as run:
                with self.assertRaises(RuntimeError):
                    bootstrap.main()
        run.assert_not_called()
        self.assertFalse(bootstrap.CONFIG.exists())


if __name__ == '__main__':
    unittest.main()
