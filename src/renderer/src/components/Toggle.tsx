//* On/off switch (a styled checkbox: stays keyboard accessible)
interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}

export const Toggle = ({ checked, onChange, label, hint, disabled }: ToggleProps) => (
  <label className={`toggle ${disabled ? 'toggle--disabled' : ''}`}>
    <span className="toggle__text">
      <span className="toggle__label">{label}</span>
      {hint && <span className="toggle__hint">{hint}</span>}
    </span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="toggle__track" aria-hidden />
  </label>
)
