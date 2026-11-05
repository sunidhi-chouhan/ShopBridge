import type { InputHTMLAttributes } from "react";

export function SearchField({
  id,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string }) {
  return (
    <div className="search-field">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <input id={id} type="search" {...props} />
    </div>
  );
}
