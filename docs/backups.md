# Backups (Postgres)

## Why Not GitHub
Do not push database backups to GitHub. Even in private repos, data can leak via:
- accidental sharing (forks, collaborator access)
- permanent history (rewriting history is hard and unreliable)
- dependency scanners and logs

Use an object storage bucket instead (Cloudflare R2, S3, Backblaze B2) with encryption + retention.

## Local Backups On The VPS

### Create Backup
This streams `pg_dump` from the running Postgres container and writes a gzipped SQL file under `backups/`.

```bash
./scripts/backup-postgres.sh
```

Optional:
- Override output path: `./scripts/backup-postgres.sh backups/vultstrike_manual.sql.gz`
- Override compose project: `DOKPLOY_COMPOSE_PROJECT=vultstrike-vultstrike-6pvzhh ./scripts/backup-postgres.sh`

### Restore Backup (Dangerous)
Restore will overwrite data. The script requires an explicit confirmation flag.

```bash
RESTORE_CONFIRM=YES ./scripts/restore-postgres.sh backups/vultstrike_YYYYMMDD_HHMMSS.sql.gz
```

## Offsite (Recommended)
Minimum viable setup:
- A bucket (R2/S3/B2)
- A scheduled job (cron) every 3 hours
- Retention: 7-30 days
- Encryption at rest (bucket) and optionally client-side encryption

Implementation options:
- `rclone` to push `backups/*.sql.gz` to the bucket
- or a dedicated backup container/job that runs `pg_dump` and uploads directly

## Offsite (Interim: Cloudinary)
If you do not have object storage yet, Cloudinary can be used as an interim offsite target.
This is not ideal for databases, so only do this if you:
- encrypt dumps before upload
- set a retention policy (delete old backups)
- rotate credentials and treat them as production secrets

Script:
```bash
# Recommended: set a passphrase so the uploaded dump is encrypted.
export BACKUP_ENCRYPTION_PASSPHRASE="change-me"
export CLOUDINARY_CLOUD_NAME="..."
export CLOUDINARY_API_KEY="..."
export CLOUDINARY_API_SECRET="..."
export BACKUP_RETENTION_COUNT="56" # keep newest N backups

./scripts/offsite-backup-cloudinary.sh
```

## Restore Drill
Once per week (timeboxed):
1. Create a fresh backup.
2. Restore it into a throwaway Postgres instance/container.
3. Run minimal verification queries (user count, match count).
4. Record how long it took and any missing steps.
