# Public Schedule page

The application allows to book a meeting with a user of [Huly Platform](./https://github.com/hcengineering/platform). This works in pair with the platform's feature "Public Schedule". A Huly user can create a public schedule in their calendar and share a link to it with external users. The link opens this application allowing the external user to select a free timeslot and book a meeting with the Huly user. The meeting gets added to the user's calendar in Huly. Also the schedule applicaion sends confirmation emails with iCal attachment to both participants, so they can add the meeting in their personal calendars on other platforms (e.g. Google).

## Development

The project is not a part of the turbo workspace which is on the root level of the repo, so dependencies must be installed separately:

```bash
npm install
```

Build and run:

```bash
npm run start
```

`astro dev` does not work because of external modules published in CommonJS format. `astro dev` likes ESM and does not understant CommonJS properly. So the hot-reload feature is not available as well.

## Deployment

Add and push a version tag:

```
git tag -a v0.0.5
git push origin v0.0.5
```

Build should start on GitHub automatically. Target image has the `service_` prefix to mark it as "internal". Then update the version tag in the [platform](https://github.com/hcengineering/platform/tree/develop/pods/external/services.d). The sevice will be automatically pulled, retagged with the lates platform version, and deployed on the cluster.

## Configuration

- `ACCOUNT_URL` - address of Huly Account service.
- `PORT` - an HTTP port the server listens to.
- `SECRET` - a service secret uset to talk to Account service
- `SMTP_URL` - address of Huly SMTP proxy used for sending meeting confirmation emails.
- `LOG_LEVEL` - trace | debug | info | warn | error.
- `FRONT_URL` - address of the frontend.
