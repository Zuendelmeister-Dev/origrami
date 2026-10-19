"""Create local configuration exclusively; never overwrite existing secrets."""
import os
from pathlib import Path
import secrets


def main():
    os.umask(0o077)
    destination = Path('/workspace/.env')
    try:
        with destination.open('x', encoding='ascii') as stream:
            stream.write('ORIGRAMI_DB_PASSWORD=' + secrets.token_hex(32) + '\n')
    except FileExistsError:
        print('.env already exists. It was not overwritten.')
        return
    print('Created .env with a unique local database password.')


if __name__ == '__main__':
    main()
