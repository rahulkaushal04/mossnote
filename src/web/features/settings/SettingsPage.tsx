import { useEffect, useState, type ReactNode } from 'react';
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

/** The sections this build shows: the web app has no phone access to set up. */
const VISIBLE_SECTIONS = SECTIONS.filter((section) => !(section.id === 'phone' && IS_STANDALONE));

/**
 * The section nearest the top of the screen, for the side navigation to mark. Without
 * IntersectionObserver (old browsers, tests) the first section stays marked.
 */
function useActiveSection(): [string, (id: string) => void] {
  const [active, setActive] = useState<string>(VISIBLE_SECTIONS[0]?.id ?? '');
  useEffect(() => {
    // The last sections are shorter than the screen, so they can never reach the top band below;
    // at the foot of the page the last one counts as current.
    const onScroll = () => {
      const atFoot =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      const last = VISIBLE_SECTIONS.at(-1);
      if (atFoot && last) setActive(last.id);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    // A section counts as current while it crosses a band near the top of the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = VISIBLE_SECTIONS.find((section) => visible.has(section.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-10% 0px -75% 0px' },
    );
    for (const section of VISIBLE_SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => {
      observer.disconnect();
    };
  }, []);
  return [active, setActive];
}

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

/**
 * `/settings`: one scrolling page with anchored sections, no tabs. From 900px a side navigation
 * stays beside the sections and marks the one in view; below that the sections are a row of pills.
 */
export default function SettingsPage() {
  const { hash } = useLocation();
  const [active, setActive] = useActiveSection();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      <PageHeader
        title="Settings"
        intro={`How Mossnote looks, plus your data. Everything stays ${WHERE_IT_LIVES.place}.`}
      />
      <div className="wide:grid wide:grid-cols-[10rem_minmax(0,1fr)] wide:gap-x-8">
        <nav
          aria-label="Settings sections"
          className="hidden wide:sticky wide:top-8 wide:block wide:self-start"
        >
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {VISIBLE_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="side-link"
                  aria-current={active === section.id ? 'location' : undefined}
                  onClick={() => {
                    setActive(section.id);
                  }}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <nav
            aria-label="Settings sections"
            className="scroll-row -mx-4 flex gap-2 overflow-x-auto px-4 py-3 phone:mx-0 phone:flex-wrap phone:px-0 wide:hidden"
          >
            {VISIBLE_SECTIONS.map((section) => (
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
        </div>
      </div>
    </>
  );
}
