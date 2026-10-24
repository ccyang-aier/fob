'use client';

import { useTranslation } from '@/lib/i18n';
import { messages } from './i18n/project-resources';

import { useIdentity } from '@/features/identity/identity-provider';
import type { Project } from '@fob/shared/projects';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { projectClient } from './project-client';

export type ProjectResource = Project & { source: 'local' | 'server' };
type ProjectState = { projects: ProjectResource[]; selectedId: string | null };
type ResourceContext = {
  projects: ProjectResource[];
  selectedProject: ProjectResource | null;
  principal: string;
  scopeKey: string | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  selectProject: (id: string) => void;
  refreshProjects: (selectId?: string) => Promise<boolean>;
  createProject: (
    name: string,
    source?: ProjectResource['source'],
  ) => Promise<ProjectResource | null>;
  renameProject: (id: string, name: string) => Promise<boolean>;
  removeProject: (id: string) => Promise<boolean>;
};
const Context = createContext<ResourceContext | null>(null);

const projectStorageKey = 'fob.local-projects';
const activeProjectKey = (principal: string) => `fob.project.active.${principal}`;
function readStorage<T>(key: string, fallback: T): T {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveStorage(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function ProjectResourceProvider({ children }: { children: ReactNode }) {
  const { session } = useIdentity();
  const principal = session.status === 'authenticated' ? session.user.id : 'guest';
  return (
    <ProjectResourceScope key={principal} principal={principal}>
      {children}
    </ProjectResourceScope>
  );
}

function ProjectResourceScope({ children, principal }: { children: ReactNode; principal: string }) {
  const { t } = useTranslation(messages);

  const [state, setState] = useState<ProjectState>({
    projects: [],
    selectedId: null,
  });
  const snapshot = useRef(state);
  const scope = useRef<AbortController | null>(null);
  const updateState = useCallback((change: (current: ProjectState) => ProjectState) => {
    const next = change(snapshot.current);
    snapshot.current = next;
    setState(next);
    return next;
  }, []);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const selectionKey = activeProjectKey(principal);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    const selectedId = readStorage<string | null>(selectionKey, null);
    const local = readStorage<Project[]>(projectStorageKey, []).map((project) => ({
      ...project,
      source: 'local' as const,
    }));
    const publish = (projects: ProjectResource[]) => {
      if (controller.signal.aborted) return;
      updateState(() => ({ projects, selectedId }));
      if (principal === 'guest' || projects.length > 0) setStatus('ready');
    };
    queueMicrotask(() => publish(local));
    if (principal !== 'guest') {
      void projectClient
        .list(controller.signal)
        .then((projects) => {
          if (controller.signal.aborted) return;
          updateState((current) => ({
            ...current,
            projects: [
              ...current.projects.filter((project) => project.source === 'local'),
              ...projects.map((project) => ({ ...project, source: 'server' as const })),
            ],
          }));
          setStatus('ready');
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : '服务端项目加载失败');
          setStatus('ready');
        });
    }
    return () => controller.abort();
  }, [principal, selectionKey, updateState]);

  const selectedProject = state.projects.find((project) => project.id === state.selectedId) ?? state.projects[0] ?? null;
  const persist = (change: (current: ProjectState) => ProjectState, saveLocal = false) => {
    const next = change(snapshot.current);
    if (saveLocal) saveStorage(projectStorageKey, next.projects.filter(project => project.source === 'local').map(({ id, name }) => ({ id, name })));
    updateState(() => next);
    try { saveStorage(selectionKey, next.selectedId); } catch { setError(t('项目选择仅在当前会话生效')); }
  };
  const value: ResourceContext = {
    projects: state.projects,
    selectedProject,
    scopeKey: selectedProject ? `${principal}:${selectedProject.source}:${selectedProject.id}` : null,
    principal,
    status,
    error,

    selectProject: (id) => {
      if (state.projects.some((item) => item.id === id)) {
        persist((current) => ({ ...current, selectedId: id }));
      }
    },
    refreshProjects: async (selectId) => {
      const signal = scope.current?.signal;
      if (!signal || signal.aborted || principal === 'guest') return false;
      try {
        const projects = await projectClient.list(signal);
        if (signal.aborted) return false;
        persist((current) => {
          const next = [
            ...current.projects.filter((project) => project.source === 'local'),
            ...projects.map((project) => ({ ...project, source: 'server' as const })),
          ];
          return {
            ...current,
            projects: next,
            selectedId:
              selectId && next.some((project) => project.id === selectId)
                ? selectId
                : current.selectedId,
          };
        });
        setError(null);
        setStatus('ready');
        return true;
      } catch (cause) {
        if (!signal.aborted) setError(cause instanceof Error ? cause.message : '项目列表刷新失败');
        return false;
      }
    },
    createProject: async (name, source = selectedProject?.source ?? 'local') => {
      const title = name.trim();
      const signal = scope.current?.signal;
      if (!title || !signal || signal.aborted) return null;
      try {
        if (source === 'server' && principal === 'guest')
          throw new Error(t('登录后才能创建服务端项目'));
        const project =
          source === 'server'
            ? await projectClient.create(title)
            : { id: crypto.randomUUID(), name: title };
        if (signal.aborted) return null;
        const created = { ...project, source };
        persist((current) => ({
          ...current,
          projects: [...current.projects.filter((project) => project.id !== created.id), created],
          selectedId: created.id,
        }), source === 'local');
        setError(null);
        return created;
      } catch (cause) {
        if (!signal.aborted) setError(cause instanceof Error ? cause.message : '项目创建失败');
        return null;
      }
    },
    renameProject: async (id, name) => {
      const title = name.trim();
      const resource = state.projects.find((project) => project.id === id);
      const signal = scope.current?.signal;
      if (!title || !resource || !signal || signal.aborted) return false;
      try {
        const project =
          resource.source === 'server'
            ? await projectClient.rename(id, title)
            : { id, name: title };
        if (signal.aborted) return false;
        const updated = { ...project, source: resource.source };
        persist((current) => ({
          ...current,
          projects: current.projects.map((project) => (project.id === id ? updated : project)),
        }), resource.source === 'local');
        setError(null);
        return true;
      } catch (cause) {
        if (!signal.aborted) setError(cause instanceof Error ? cause.message : '项目重命名失败');
        return false;
      }
    },
    removeProject: async (id) => {
      const resource = state.projects.find((project) => project.id === id);
      const signal = scope.current?.signal;
      if (!resource || !signal || signal.aborted) return false;
      try {
        if (resource.source === 'server') await projectClient.remove(id);
        if (signal.aborted) return false;
        persist((current) => {
          const projects = current.projects.filter((project) => project.id !== id);
          return {
            projects,
            selectedId: current.selectedId === id ? (projects[0]?.id ?? null) : current.selectedId,
          };
        }, resource.source === 'local');
        setError(null);
        return true;
      } catch (cause) {
        if (!signal.aborted) setError(cause instanceof Error ? cause.message : '项目删除失败');
        return false;
      }
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProjectResources() {
  const value = useContext(Context);
  if (!value) throw new Error('ProjectResourceProvider is required');
  return value;
}
