import { ReviewResult } from '../types';
import { el, mountOverlay, typewriter } from './dom';

interface ShowReviewOpts {
  result: ReviewResult;
  changes: string[];        // human-readable list of next-wave changes
  nextWaveLabel: string;    // e.g. "下一波 / Wave 6 之 10"
  onContinue: () => void;
  isLoading?: boolean;
  onLoadingMsg?: string;
}

/**
 * Show the review panel. If isLoading=true, displays a thinking spinner with
 * a placeholder card; the caller swaps it via showReview again once result arrives.
 */
export function showReview(opts: ShowReviewOpts): { close: () => void } {
  const panel = el('div', { cls: 'cs-panel wide' });

  panel.appendChild(el('div', { cls: 'cs-panel-title', text: '心魔复盘' }));
  panel.appendChild(el('div', { cls: 'cs-panel-sub', text: 'DEMON RECAP' }));

  if (opts.isLoading) {
    panel.appendChild(el('div', { cls: 'cs-thinking', text: opts.onLoadingMsg ?? '心魔们在低声商议……' }));
    panel.appendChild(el('div', { cls: 'cs-monologue', text: '……' }));
  } else {
    const r = opts.result;
    // Source badge
    const sourceLabel = el('div', {
      cls: 'cs-section-label',
      text: r.fromLLM ? `LLM 实时生成 · 心声 #${Math.floor(Math.random() * 9000 + 1000)}` : '本地心声库 (未配置 LLM 时启用)',
    });
    panel.appendChild(sourceLabel);

    // Monologue with typewriter effect
    const mono = el('div', { cls: 'cs-monologue' });
    panel.appendChild(mono);
    typewriter(mono, r.monologue, 36);

    // Lessons
    if (r.lesson.length) {
      panel.appendChild(el('div', { cls: 'cs-section', attrs: { style: 'margin-top:18px;' } }, [
        el('div', { cls: 'cs-section-label', text: '它们学到了什么' }),
        el('div', { cls: '', attrs: { style: 'padding-top:6px;' } },
          r.lesson.map(t => el('span', { cls: 'cs-lesson-tag', text: t }))),
      ]));
    }

    // Strategy block
    const ns = r.next_strategy;
    panel.appendChild(el('div', { cls: 'cs-section' }, [
      el('div', { cls: 'cs-section-label', text: '下一波它们的策略 (next_strategy)' }),
      el('div', { cls: 'cs-strategy-block' }, [
        el('div', { cls: 'cs-strategy-card' }, [
          el('div', { cls: 'lbl', text: 'PATH BIAS' }),
          el('div', { cls: 'val', text: ns.path_weight_shift }),
        ]),
        el('div', { cls: 'cs-strategy-card' }, [
          el('div', { cls: 'lbl', text: 'FORMATION' }),
          el('div', { cls: 'val', text: ns.formation }),
        ]),
        el('div', { cls: 'cs-strategy-card' }, [
          el('div', { cls: 'lbl', text: 'AGGRESSION' }),
          el('div', { cls: 'val', text: ns.aggression.toFixed(2) }),
        ]),
        el('div', { cls: 'cs-strategy-card' }, [
          el('div', { cls: 'lbl', text: 'SKILLS' }),
          el('div', { cls: 'val', text: ns.skill_priority.join(' · ') || '—' }),
        ]),
        el('div', { cls: 'cs-strategy-card', attrs: { style: 'grid-column: span 2;' } }, [
          el('div', { cls: 'lbl', text: 'PREFERRED KINDS' }),
          el('div', { cls: 'val', text: ns.preferred_kinds.join(' · ') || '—' }),
        ]),
      ]),
    ]));

    // Concrete changes that the engine applied
    if (opts.changes.length) {
      panel.appendChild(el('div', { cls: 'cs-section' }, [
        el('div', { cls: 'cs-section-label', text: '已生效的下波变化 (engine applied)' }),
        ...opts.changes.map(c =>
          el('div', { cls: '', attrs: { style: 'font-size:13px; color:#34d399; padding:3px 0; letter-spacing:1px;' }, text: '› ' + c }),
        ),
      ]));
    }

    panel.appendChild(el('div', { cls: 'cs-actions' }, [
      el('button', {
        cls: 'cs-btn primary',
        text: opts.nextWaveLabel,
        on: { click: () => { handle.close(); opts.onContinue(); } },
      }),
    ]));
  }

  const handle = mountOverlay(panel);
  return handle;
}
