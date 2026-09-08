export type AppView = 'projects' | 'kanban' | 'scratch' | 'feed' | 'approvals' | 'reports' | 'activity' | 'obligations' | 'meetings';

const APP_VIEWS = new Set<AppView>(['projects', 'kanban', 'scratch', 'feed', 'approvals', 'reports', 'activity', 'obligations', 'meetings']);

export const parseAppView = (value: string | null | undefined): AppView =>
  value && APP_VIEWS.has(value as AppView) ? value as AppView : 'projects';
