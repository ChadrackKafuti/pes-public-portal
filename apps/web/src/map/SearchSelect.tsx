import { useEffect, useRef, useState } from "react";

/** M16 — a searchable single-select dropdown (calcite-combobox manners):
 *  a button showing the current value, a panel with a filter input and the
 *  matching options. Value "" means "any" and shows the placeholder. */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      inputRef.current?.focus();
    }
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => o.toLowerCase().includes(needle))
    : options;

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="an-combo">
      <button
        type="button"
        className="an-combo-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {value ? (
          <span className="an-combo-sel">
            <strong>{value}</strong>
          </span>
        ) : (
          <span className="an-combo-ph">{placeholder}</span>
        )}
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <>
          <div className="an-combo-backdrop" onClick={() => setOpen(false)} />
          <div className="an-combo-list an-combo-panel">
            <input
              ref={inputRef}
              type="search"
              className="an-combo-search"
              value={q}
              placeholder={searchPlaceholder}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown.length === 1) pick(shown[0]);
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <ul role="listbox">
              <li role="option" aria-selected={value === ""}>
                <button type="button" onClick={() => pick("")}>
                  <strong>{placeholder}</strong>
                </button>
              </li>
              {shown.map((o) => (
                <li key={o} role="option" aria-selected={o === value}>
                  <button type="button" onClick={() => pick(o)}>
                    <strong>{o}</strong>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
