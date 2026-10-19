# Roadmap

Origrami aims to become an everyday self-hosted messenger that gives people control over their infrastructure and keeps private content on participants' devices. Version 0.1.0 establishes encrypted text chats and account administration.

The following areas describe planned development, not features already available or commitments to a release date. Priorities may change as the project evolves.

## Privacy and recovery

- Device verification and clearer identity and device-change notices.
- Encrypted key backup, recovery and safe transfer between devices, with recovery secrets controlled by users.
- Coordinated server backups and tested restoration of accounts, configuration, media and management state.
- Stronger client distribution and browser security, alongside independent security review.

Server backups and encrypted message-key backups solve different problems. Restoring a server or resetting a password must not imply that private message keys have been recovered.

## Hosting and deployment

- Kubernetes deployment support with documented configuration, persistent storage, secrets and upgrades.
- Public HTTPS deployment guidance, improved monitoring and operational health checks.
- Stronger registration abuse protection and testing under larger workloads.

Docker Compose remains the starting point for local development and testing.

## Mobile apps

- Dedicated Android and iOS apps.
- Secure device enrolment and integration with device verification and key recovery.
- Mobile notifications and a consistent experience across desktop and mobile devices.

## Accounts and identity providers

- Identity provider integration and single sign-on, for example through OpenID Connect.
- Administrator-assisted password resets with explicit permissions, protected superuser accounts and recorded actions.
- Account reactivation and clearer account recovery workflows.

Administrative password resets should restore account access without exposing the password to administrators or granting access to private message keys. They must preserve the distinction between account recovery and encrypted-history recovery.

## Messaging and expression

- End-to-end encrypted images, videos and file attachments, including protected previews.
- Custom emoji and emoji packs, with upload and moderation controls.
- Message reactions, richer conversation tools and loading older history.

## Design and accessibility

- Further visual polish, refined typography and more consistent interactions.
- Additional themes and personal appearance settings, building on the existing black/gold and burgundy palettes.
- Better layouts for small screens, keyboard navigation and screen-reader support.

For implemented features, see the [changelog](../CHANGELOG.md). Current protection boundaries and release requirements remain documented in the [security model](../SECURITY.md).
