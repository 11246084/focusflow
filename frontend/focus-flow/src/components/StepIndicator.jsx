import { Ic } from './Icons';

export default function StepIndicator({ steps, currentStep }) {
  return (
    <div className="step-indicator">
      {/* Desktop/tablet: full node + connector layout */}
      <div className="step-indicator-full">
        {steps.map((label, idx) => {
          const n = idx + 1;
          const status = n < currentStep ? 'done' : n === currentStep ? 'active' : 'upcoming';
          return (
            <div className="step-indicator-item" key={label}>
              <div className="step-indicator-node-row">
                <div className={`step-indicator-node ${status}`}>
                  {status === 'done' ? <Ic n="check" s={13} c="#fff" /> : n}
                </div>
                {idx < steps.length - 1 && (
                  <div className={`step-indicator-line${n < currentStep ? ' done' : ''}`} />
                )}
              </div>
              <div className={`step-indicator-label ${status}`}>{label}</div>
            </div>
          );
        })}
      </div>

      {/* Mobile: compact "step X / N" text + progress bar */}
      <div className="step-indicator-compact">
        <div className="step-indicator-compact-text">
          步驟 {currentStep} / {steps.length}：{steps[currentStep - 1]}
        </div>
        <div className="step-indicator-progress">
          <div
            className="step-indicator-progress-fill"
            style={{ width: `${(currentStep / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
