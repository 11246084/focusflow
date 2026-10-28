import { useId } from 'react';
import { Ic } from '../components/Icons';
import { StatusPill } from './shortScriptUi';
import { BODY, GHOST_BTN, HEADING, MUTED, SECTION_LABEL, SMALL_BTN } from './shortScriptStyles';

// 短影片腳本頁、上傳短片頁右欄「尚未選擇腳本」時的引導：建議下一步。
// 只用頁面已載入的清單推算，不另外打 API；手機單欄直接顯示清單，不會用到這裡。
// 這些區塊在同一個面板裡，彼此用分隔線分開，不另加卡片底色。

const FLOW_STEPS = [
  ['plus', '建立腳本'],
  ['spark', '生成腳本'],
  ['camera', '拍攝並上傳短片'],
  ['checkCircle', '審核通過後學生可見'],
];

// row 有值時顯示那一份腳本與按鈕；沒有時顯示 children（引導建立或前往別頁）。
// primary：這一頁頂部沒有其他主要按鈕時才用主要樣式（腳本頁頂部已有「＋ 新腳本」）。
export function NextStepCard({ row, actionLabel, onOpen, primary = false, children }) {
  const titleId = useId();
  return (
    <section className="ss-next" aria-labelledby={titleId}>
      <div id={titleId} style={SECTION_LABEL}>建議下一步</div>
      {row ? (
        <>
          <div className="ss-next-title">{row.script.topic}</div>
          <div className="ss-next-meta">
            <StatusPill status={row.status} />
            {row.status.next && <span style={MUTED}>{row.status.next}</span>}
          </div>
          <div>
            <button type="button" className="btn-primary" style={primary ? SMALL_BTN : GHOST_BTN} onClick={() => onOpen(row.script._id)}>
              {actionLabel}
            </button>
          </div>
        </>
      ) : children}
    </section>
  );
}

// 課程還沒有可列的腳本時：一段引導文字＋按鈕，不顯示全部為 0 的內容。
export function StartGuide({ title, children, action }) {
  return (
    <section className="ss-next">
      <div style={{ ...HEADING, fontSize: 14 }}>{title}</div>
      <div style={BODY}>{children}</div>
      {action && <div>{action}</div>}
    </section>
  );
}

// 流程說明：頁首常駐、不收合，放在主面板之上。一列步驟＋一行說明，不加卡片底色。
export function FlowBar() {
  return (
    <div className="ss-flow-bar">
      <ol className="ss-flow-steps">
        {FLOW_STEPS.map(([icon, label], index) => (
          <li key={label}>
            <span className="ss-flow-icon" aria-hidden="true"><Ic n={icon} s={13} /></span>
            {label}
            {index < FLOW_STEPS.length - 1 && <span className="ss-flow-arrow" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>
      <div style={{ ...MUTED, marginTop: 6, lineHeight: 1.7 }}>
        建立只凍結證據；生成約 30–45 秒。上傳後影片先以非公開傳上 YouTube，審核通過才進學生的短影片牆。
      </div>
    </div>
  );
}
