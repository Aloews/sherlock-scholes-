import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/supabase-production-backup.yml', 'utf8');
const readme = readFileSync('scripts/backup/README.md', 'utf8');

describe('Supabase production backup safety', () => {
  it('runs only on a schedule or explicit manual dispatch', () => {
    const triggerSection = workflow.slice(0, workflow.indexOf('\njobs:'));
    expect(triggerSection).toContain('schedule:');
    expect(triggerSection).toContain('workflow_dispatch:');
    expect(triggerSection).not.toContain('pull_request:');
    expect(triggerSection).not.toContain('push:');
  });

  it('dumps PostgreSQL 17, validates the archive, and uploads a checksum', () => {
    expect(workflow).toContain('postgres:17-alpine');
    expect(workflow).toContain('pg_dump --no-password --format=custom');
    expect(workflow).toContain('pg_restore --list');
    expect(workflow).toContain('database.dump.sha256');
    expect(workflow).toContain('rclone check');
  });

  it('backs up Supabase Storage object bytes to a separate S3 destination', () => {
    expect(workflow).toContain('rclone lsf supabase: --dirs-only');
    expect(workflow).toContain('rclone copy "$source" "$destination"');
    expect(workflow).toContain('storage/$bucket');
    expect(workflow).toContain('BACKUP_S3_BUCKET');
    expect(readme).toContain('separate bucket');
    expect(readme).toContain('actual object bytes');
  });

  it('has no automatic destructive retention or restore commands', () => {
    expect(workflow).not.toMatch(/--clean|TRUNCATE|DROP TABLE|supabase db reset|storage rm/i);
    expect(workflow).not.toContain('actions/upload-artifact');
    expect(readme).toContain('never deletes or overwrites previous backups');
    expect(readme).toContain('No restore is claimed');
  });

  it('fails visibly when the scheduled backup job fails', () => {
    const watchStart = workflow.indexOf('  watch:\n');
    const watch = workflow.slice(watchStart);
    expect(watch).toContain('needs: [backup]');
    expect(watch).toContain('if: always()');
    expect(watch).toContain('BACKUP_RESULT');
  });
});
