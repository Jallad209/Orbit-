import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { MissingRecordPage } from '@/pages/MissingRecordPage';
import { Placeholder } from '@/pages/Placeholder';
import { InboxPage } from '@/features/inbox/InboxPage';
import { AreasPage } from '@/features/structure/AreasPage';
import { GoalPage, GoalsPage } from '@/features/structure/GoalsPage';
import { ProjectsPage } from '@/features/structure/ProjectsPage';
import { ProjectPage } from '@/features/structure/ProjectPage';
import { TaskPage } from '@/features/structure/TaskPage';
import { TodayPage } from '@/features/today/TodayPage';
import { TimelinePage } from '@/features/timeline/TimelinePage';
import { FirstRunPage } from '@/features/firstRun/FirstRunPage';
import { BillPage } from '@/features/bills/BillPage';
import { BillsPage } from '@/features/bills/BillsPage';
import { NotePage } from '@/features/notes/NotePage';
import { NotesPage } from '@/features/notes/NotesPage';
import { PeoplePage } from '@/features/people/PeoplePage';
import { PersonPage } from '@/features/people/PersonPage';
import { isFirstRunDone } from '@/features/firstRun/firstRun';
import { QuickCaptureWindow } from '@/features/inbox/QuickCaptureWindow';
import { EveningFlow } from '@/features/reviews/EveningFlow';
import { MorningFlow } from '@/features/reviews/MorningFlow';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { usePlatform } from '@/platform';

// The search page (and its result/preview UI) loads on first visit.
const SearchPage = lazy(() =>
  import('@/features/search/SearchPage').then((m) => ({ default: m.SearchPage })),
);
// The insights page, cards, and evidence renderer load on first visit; the engine itself
// runs from the shell so the Today strip and the Timeline warning share one computation.
const InsightsPage = lazy(() =>
  import('@/features/insights/InsightsPage').then((m) => ({ default: m.InsightsPage })),
);

const ComponentsGallery = import.meta.env.DEV
  ? lazy(() =>
      import('@/pages/dev/ComponentsGallery').then((m) => ({ default: m.ComponentsGallery })),
    )
  : null;

/**
 * Every screen from ORBIT-SPEC §8. Placeholders are replaced week by week.
 * `Placeholder` exists so navigation, hotkeys, and layout can be tested now.
 */
export function AppRoutes() {
  const platform = usePlatform();
  const { pathname } = useLocation();
  const welcome = platform.capabilities.dataFolder && !isFirstRunDone();
  if (welcome && pathname !== '/welcome' && pathname !== '/capture') {
    return <Navigate to="/welcome" replace />;
  }
  return (
    <Routes>
      {/* The quick-capture window has no shell around it. */}
      <Route path="/capture" element={<QuickCaptureWindow />} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={welcome ? '/welcome' : '/today'} replace />} />
        <Route path="/welcome" element={<FirstRunPage />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/goals/:id" element={<GoalPage />} />
        <Route path="/areas" element={<AreasPage />} />
        <Route
          path="/insights"
          element={
            <Suspense fallback={null}>
              <InsightsPage />
            </Suspense>
          }
        />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/people/:id" element={<PersonPage />} />
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/bills/:id" element={<BillPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:id" element={<NotePage />} />
        <Route path="/tasks/:id" element={<TaskPage />} />
        <Route path="/review/morning" element={<MorningFlow />} />
        <Route path="/review/evening" element={<EveningFlow />} />
        <Route
          path="/review/weekly"
          element={<Placeholder title="Weekly review" description="Arrives in week 12." />}
        />
        <Route
          path="/search"
          element={
            <Suspense fallback={null}>
              <SearchPage />
            </Suspense>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/missing" element={<MissingRecordPage />} />
        {ComponentsGallery ? (
          <Route
            path="/dev/components"
            element={
              <Suspense fallback={null}>
                <ComponentsGallery />
              </Suspense>
            }
          />
        ) : null}
        <Route
          path="*"
          element={<Placeholder title="Not found" description="That screen does not exist." />}
        />
      </Route>
    </Routes>
  );
}
