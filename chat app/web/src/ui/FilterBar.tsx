type Option<T extends string> = { value: T | ""; label: string };

export function FilterBar<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T | "";
  options: Option<T>[];
  onChange: (value: T | "") => void;
}) {
  return (
    <fieldset className="filter-bar">
      <legend className="visually-hidden">{legend}</legend>
      {options.map((option) => (
        <button
          key={option.value || "all"}
          type="button"
          className="filter-chip"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
