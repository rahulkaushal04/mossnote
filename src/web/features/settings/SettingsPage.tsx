import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { PageHeader } from '../../components/ui/PageHeader';
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
import { DataSection } from './DataSection';
import { LayoutSection } from './LayoutSection';
import { TagsSection } from './TagsSection';
import { TrashSection } from './TrashSection';
import { useUpdateSettings } from './useSettings';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const SIZES: { value: ReadingSize; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'large', label: 'Large' },
];

function RadioGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="mb-1 font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {options.map((option) => (
          <label key={option.value} className="tap flex items-center gap-2">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value);
              }}
              className="size-4 accent-accent"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="flex scroll-mt-20 flex-col gap-4 border-t border-rule py-6 first:border-t-0"
    >
      <h2 id={`${id}-heading`} className="text-xl font-semibold">
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
      <RadioGroup legend="Theme" name="theme" options={THEMES} value={theme} onChange={setTheme} />
      <RadioGroup
        legend="Reading size"
        name="reading-size"
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

/** `/settings`: one scrolling page with anchored sections, no tabs (spec section 8.11). */
export default function SettingsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      <PageHeader title="Settings" />
      <Section id="appearance" title="Appearance">
        <Appearance />
      </Section>
      <Section id="game" title="Game and sections">
        <LayoutSection />
      </Section>
      <Section id="calendar" title="Game calendar">
        <CalendarSection />
      </Section>
      <Section id="tags" title="Tags">
        <TagsSection />
      </Section>
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
