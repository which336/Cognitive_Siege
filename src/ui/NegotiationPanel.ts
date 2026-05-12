import { BossPersona, ChoiceTag, DialogueChoice, DialogueTurn } from '../types';
import { el, mountOverlay, typewriter } from './dom';
import { Sound } from '../game/systems/Audio';

export interface NegotiationPanelHandle {
  showLoading: (msg?: string) => void;
  showTurn: (turn: DialogueTurn, onChoice: (c: DialogueChoice) => void) => Promise<void>;
  showResolution: (note: string, onContinue: () => void) => void;
  close: () => void;
}

export function openNegotiation(persona: BossPersona, turnIndex: number, totalTurns: number): NegotiationPanelHandle {
  const panel = el('div', { cls: 'cs-panel wide' });

  panel.appendChild(el('div', { cls: 'cs-panel-title', text: '首领谈判' }));
  panel.appendChild(el('div', { cls: 'cs-panel-sub', text: `首领谈判 · ${persona.displayName}` }));

  const dialogRow = el('div', { cls: 'cs-dialog-row' });
  const bossPortrait = bossPortraitUrl(persona);
  const portrait = el('div', {
    cls: bossPortrait ? 'cs-dialog-portrait image' : 'cs-dialog-portrait',
    text: bossPortrait ? '' : persona.emoji,
    attrs: bossPortrait ? { style: `background-image:url("${bossPortrait}")` } : undefined,
  });
  const dialogBox = el('div', { attrs: { style: 'flex:1; min-width:0;' } });
  const nameEl = el('div', { cls: 'cs-dialog-name', text: persona.displayName });
  const turnLabel = el('div', {
    cls: 'cs-section-label',
    text: `轮次 ${turnIndex + 1} / ${totalTurns}`,
    attrs: { style: 'margin-bottom:8px;' },
  });
  const textEl = el('div', { cls: 'cs-dialog-text', text: '' });
  dialogBox.appendChild(nameEl);
  dialogBox.appendChild(turnLabel);
  dialogBox.appendChild(textEl);

  dialogRow.appendChild(portrait);
  dialogRow.appendChild(dialogBox);
  panel.appendChild(dialogRow);

  const choicesEl = el('div', { cls: 'cs-choice-list' });
  panel.appendChild(choicesEl);

  const handle = mountOverlay(panel);

  return {
    showLoading: (msg = '它正在斟酌……') => {
      choicesEl.innerHTML = '';
      textEl.textContent = '';
      textEl.appendChild(el('div', { cls: 'cs-thinking', text: msg }));
    },
    showTurn: async (turn, onChoice) => {
      choicesEl.innerHTML = '';
      textEl.textContent = '';
      await typewriter(textEl, turn.bossLine, 32);
      for (const c of turn.choices) {
        const tagSpan = `<span class="tag ${c.tag}">${choiceTagLabel(c.tag)}</span>`;
        const btn = el('button', {
          cls: 'cs-choice',
          html: tagSpan + escapeHtml(c.text),
          on: { click: () => { Sound.play('choice_pick'); onChoice(c); } },
        });
        choicesEl.appendChild(btn);
      }
    },
    showResolution: (note, onContinue) => {
      choicesEl.innerHTML = '';
      const noteBox = el('div', {
        cls: 'cs-monologue',
        attrs: { style: 'color:#67e8f9; border-left-color:#67e8f9;' },
        text: note,
      });
      panel.appendChild(noteBox);
      panel.appendChild(el('div', { cls: 'cs-actions' }, [
        el('button', {
          cls: 'cs-btn primary',
          text: '迎战',
          on: { click: () => { handle.close(); onContinue(); } },
        }),
      ]));
    },
    close: () => handle.close(),
  };
}

function bossPortraitUrl(persona: BossPersona): string | null {
  if (persona.kindHint === 'anxiety') return 'assets/art/boss-anxiety.jpg';
  if (persona.kindHint === 'obsession') return 'assets/art/boss-obsession.jpg';
  return null;
}

function choiceTagLabel(tag: ChoiceTag): string {
  return ({
    empathy: '共情',
    confront: '对峙',
    deceive: '欺骗',
  } as Record<ChoiceTag, string>)[tag];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
