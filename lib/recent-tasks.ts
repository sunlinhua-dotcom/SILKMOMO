import { useCallback, useEffect, useRef, useState } from 'react';
import { db, type Project } from '@/lib/db';

/** 任务 + 结果图数量（只数 type='result' 的图）。 */
export interface TaskWithImages extends Project {
  imageCount: number;
}

/**
 * 读取最近任务（按创建时间倒序）。不传 limit 则返回全部。
 * Project 行不含图片数据，体量很小；图片数量按项目逐个 count。
 */
export async function loadRecentTasks(limit?: number): Promise<TaskWithImages[]> {
  let query = db.projects.orderBy('createdAt').reverse();
  if (limit !== undefined) query = query.limit(limit);
  const projects = await query.toArray();

  return Promise.all(
    projects.map(async (project) => {
      const imageCount = await db.images
        .where('projectId')
        .equals(project.id!)
        .and((img) => img.type === 'result')
        .count();
      return { ...project, imageCount };
    })
  );
}

export type RecentTasksStatus = 'loading' | 'ready' | 'error';

/**
 * 任务列表 hook：区分 loading / ready / error。
 * - `reload()`：静默刷新（不闪骨架屏）；已有数据时刷新失败保留旧数据，不进 error
 * - `retry()`：从 error 状态重试，会先回到 loading
 */
export function useRecentTasks(limit?: number) {
  const [state, setState] = useState<{ tasks: TaskWithImages[]; status: RecentTasksStatus }>({
    tasks: [],
    status: 'loading',
  });
  const aliveRef = useRef(true);
  const seqRef = useRef(0);

  /** 拉取并写入 state；供首次加载 effect（回调里 setState）和手动刷新共用。 */
  const run = useCallback(() => {
    const seq = ++seqRef.current;
    return loadRecentTasks(limit).then(
      (tasks) => {
        if (!aliveRef.current || seq !== seqRef.current) return;
        setState({ tasks, status: 'ready' });
      },
      (e) => {
        console.error('加载任务失败:', e);
        if (!aliveRef.current || seq !== seqRef.current) return;
        setState((s) => (s.status === 'ready' ? s : { tasks: s.tasks, status: 'error' }));
      }
    );
  }, [limit]);

  useEffect(() => {
    aliveRef.current = true;
    void run();
    return () => {
      aliveRef.current = false;
    };
  }, [run]);

  const reload = run;

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    void run();
  }, [run]);

  return { tasks: state.tasks, status: state.status, reload, retry };
}
