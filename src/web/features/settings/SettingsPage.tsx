import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { PageHeader } from '../../components/ui/PageHeader';
import { IS_STANDALONE, WHERE_IT_LIVES } from '../../lib/mode';
import { Segmented } from '../../components/ui/Segmented';
import {
  setReadingSize,
  setTheme,
  useCachedReadingSize,
  useThemeChoice,
  type ReadingSize,
  type ThemeChoice,
} from '../../lib/theme';
import { AboutSection } from './AboutSection';
import { CalendarSection } from './CalendarSection';
import { JournalsSection } from '../journals/JournalsSection';
import { DataSection } from './DataSection';
import { LayoutSection } from './LayoutSection';
import { PhoneSection } from './PhoneSection';
import { TagsSection } from './TagsSection';
import { TrashSection } from './TrashSection';
import { useUpdateSettings } from './useSettings';

const SECTIONS = [
  { id: 'appearance', title: 'Appearance' },
  { id: 'journals', title: 'Journals' },
  { id: 'game', title: 'Template and sections' },
  { id: 'calendar', title: 'Calendar' },
  { id: 'tags', title: 'Tags' },
  { id: 'phone', title: 'Phone' },
  { id: 'data', title: 'Data & backup' },
  { id: 'trash', title: 'Recently deleted' },
  { id: 'about', title: 'Shortcuts and about' },
] as const;

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const SIZES: { value: ReadingSize; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'large', label: 'Large' },
];

/** A visible heading over a joined choice. */
function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm font-medium text-ink-2">{legend}</p>
      <Segmented label={legend} options={options} value={value} onChange={onChange} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="flex scroll-mt-24 flex-col gap-4 border-t border-hairline py-8 first:border-t-0"
    >
      <h2 id={`${id}-heading`} className="font-serif text-xl font-medium tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Appearance() {
  const theme = useThemeChoice();
  // The local cache is the displayed value, so a choice shows at once. The saved preference
  // refreshes the cache when settings load (see Preferences in App.tsx).
  const readingSize = useCachedReadingSize();
  const update = useUpdateSettings();
  return (
    <>
      <Choice legend="Theme" options={THEMES} value={theme} onChange={setTheme} />
      <Choice
        legend="Reading size"
        options={SIZES}
        value={readingSize}
        onChange={(size) => {
          const previous = readingSize;
          setReadingSize(size);
          update.mutate(
            { prefs: { readingSize: size } },
            {
              onError: () => {
                setReadingSize(previous);
              },
            },
          );
        }}
      />
      {update.isError ? (
        <p role="status" className="text-danger">
          Couldn&apos;t save that change. It was undone.
        </p>
      ) : null}
    </>
  );
}

/** `/settings`: one scrolling page with anchored sections, no tabs. */
export default function SettingsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      <PageHeader
        title="Settings"
        intro={`Look, feel and your data. Everything stays ${WHERE_IT_LIVES.place}.`}
      />
      <nav
        aria-label="Settings sections"
        className="scroll-row -mx-4 flex gap-2 overflow-x-auto px-4 py-3 phone:mx-0 phone:flex-wrap phone:px-0"
      >
        {SECTIONS.filter((section) => !(section.id === 'phone' && IS_STANDALONE)).map((section) => (
          <a key={section.id} href={`#${section.id}`} className="pill shrink-0 no-underline">
            {section.title}
          </a>
        ))}
      </nav>
      <Section id="appearance" title="Appearance">
        <Appearance />
      </Section>
      <Section id="journals" title="Journals">
        <JournalsSection />
      </Section>
      <Section id="game" title="Template and sections">
        <LayoutSection />
      </Section>
      <Section id="calendar" title="Calendar">
        <CalendarSection />
      </Section>
      <Section id="tags" title="Tags">
        <TagsSection />
      </Section>
      {IS_STANDALONE ? null : (
        <Section id="phone" title="Phone">
          <PhoneSection />
        </Section>
      )}
      <Section id="data" title="Data & backup">
        <DataSection />
      </Section>
      <Section id="trash" title="Recently deleted">
        <TrashSection />
      </Section>
      <Section id="about" title="Shortcuts and about">
        <AboutSection />
      </Section>
    </>
  );
}
