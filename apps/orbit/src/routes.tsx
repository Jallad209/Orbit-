import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Placeholder } from '@/pages/Placeholder';

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
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/today" replace />} />
        <Route
          path="/today"
          element={
            <Placeholder
              title="Today"
              description="What matters, what is next, what is at risk. Arrives in week 5."
            />
          }
        />
        <Route
          path="/inbox"
          element={
            <Placeholder title="Inbox" description="Universal capture. Arrives in week 3." />
          }
        />
        <Route
          path="/timeline"
          element={<Placeholder title="Timeline" description="Time blocks. Arrives in week 6." />}
        />
        <Route
          path="/projects"
          element={<Placeholder title="Projects" description="Arrives in week 4." />}
        />
        <Route
          path="/projects/:id"
          element={<Placeholder title="Project" description="Arrives in week 4." />}
        />
        <Route
          path="/goals"
          element={<Placeholder title="Goals" description="Arrives in week 4." />}
        />
        <Route
          path="/areas"
          element={<Placeholder title="Areas" description="Arrives in week 4." />}
        />
        <Route
          path="/people"
          element={<Placeholder title="People" description="Arrives in week 12." />}
        />
        <Route
          path="/bills"
          element={<Placeholder title="Bills" description="Arrives in week 12." />}
        />
        <Route
          path="/notes"
          element={<Placeholder title="Notes" description="Arrives in week 12." />}
        />
        <Route
          path="/review/morning"
          element={<Placeholder title="Morning briefing" description="Arrives in week 8." />}
        />
        <Route
          path="/review/evening"
          element={<Placeholder title="Evening shutdown" description="Arrives in week 8." />}
        />
        <Route
          path="/review/weekly"
          element={<Placeholder title="Weekly review" description="Arrives in week 12." />}
        />
        <Route
          path="/search"
          element={<Placeholder title="Search" description="Arrives in week 10." />}
        />
        <Route
          path="/settings"
          element={<Placeholder title="Settings" description="Arrives in week 9." />}
        />
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
