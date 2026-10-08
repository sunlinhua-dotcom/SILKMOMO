import fs from 'node:fs';

/**
 * 任务页拆分后，原先写在 app/task/[id]/page.tsx 的逻辑分布在下面这些文件里。
 * 源码断言类测试统一读这份拼接，避免每次再拆文件都要改一遍路径。
 */
export const TASK_PAGE_SOURCE_FILES = [
  'app/task/[id]/page.tsx',
  'hooks/useTaskGeneration.ts',
  'lib/pending-recovery.ts',
  'lib/pending-recovery-core.ts',
  'lib/task-page-helpers.ts',
  ...fs.readdirSync('components/task')
    .filter((name) => /\.(tsx|ts)$/.test(name))
    .sort()
    .map((name) => `components/task/${name}`),
];

export const readTaskPageSource = () =>
  TASK_PAGE_SOURCE_FILES.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
