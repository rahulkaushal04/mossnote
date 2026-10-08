import { useId } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A short, mutually exclusive choice shown as joined segments. It is a native radio group, so the
 * arrow keys, grouping and screen reader behaviour come from the browser.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((option) => (
        <label key={option.value} className="segmented-option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => {
              onChange(option.value);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
