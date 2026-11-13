import { readFileSync } from 'node:fs';

const skills = [
  {
    path: '.agents/skills/ub-mode/SKILL.md',
    name: 'ub-mode',
    required: ['First Make it Work', 'Then Make it Right', 'Practice'],
  },
  {
    path: '.agents/skills/rea/SKILL.md',
    name: 'rea',
    required: ['Connect the local agent', 'Evidence rules'],
  },
];

const errors = [];
for (const skill of skills) {
  let content;
  try {
    content = readFileSync(skill.path, 'utf8');
  } catch {
    errors.push(`Missing skill file: ${skill.path}`);
    continue;
  }

  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    errors.push(`Missing YAML frontmatter: ${skill.path}`);
  } else {
    for (const field of ['name:', 'description:']) {
      if (!frontmatter[1].includes(field)) {
        errors.push(`Missing "${field}" in frontmatter: ${skill.path}`);
      }
    }
    if (!frontmatter[1].includes(`name: ${skill.name}`)) {
      errors.push(`Unexpected skill name in frontmatter: ${skill.path}`);
    }
  }

  for (const heading of skill.required) {
    if (!content.includes(heading)) {
      errors.push(`Missing required section "${heading}": ${skill.path}`);
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `::error::${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${skills.length} repository agent skills.`);
}
