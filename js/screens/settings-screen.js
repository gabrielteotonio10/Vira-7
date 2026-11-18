/**
 * Vira-7 — Ajustes: áudio, animações, preferências de jogo e senha.
 * As preferências ficam salvas na conta e valem em qualquer dispositivo.
 */
((F7) => {
  'use strict';

  const { h } = F7.dom;
  const App = F7.App;

  function toggle(label, hint, checked, onChange) {
    const input = h('input', { type: 'checkbox', class: 'switch__input' });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return h(
      'label',
      { class: 'setting' },
      h('span', { class: 'setting__text' }, h('strong', {}, label), h('small', {}, hint)),
      h('span', { class: 'switch' }, input, h('span', { class: 'switch__track' })),
    );
  }

  async function settings() {
    const current = { ...App.state.settings };
    let timer = null;
    const saved = h('span', { class: 'settings__saved', 'aria-live': 'polite' });

    const change = (key, value) => {
      current[key] = value;
      App.applySettings(current);
      clearTimeout(timer);
      saved.textContent = 'Salvando…';
      timer = setTimeout(async () => {
        try {
          const result = await F7.Api.put('/me/settings', { settings: current });
          App.state.me.settings = result.settings;
          saved.textContent = 'Preferências salvas ✓';
        } catch (error) {
          saved.textContent = '';
          App.toast(error.message, { variant: 'bust' });
        }
      }, 500);
    };

    const volume = h('input', { type: 'range', class: 'range', min: 0, max: 100, step: 5, value: Math.round(current.volume * 100), 'aria-label': 'Volume' });
    const volumeValue = h('b', {}, `${Math.round(current.volume * 100)}%`);
    volume.addEventListener('input', () => {
      volumeValue.textContent = `${volume.value}%`;
      change('volume', Number(volume.value) / 100);
    });
    volume.addEventListener('change', () => {
      F7.Sound.unlock();
      F7.Sound.number(3);
    });

    const speed = F7.Screens.segmented([[1, 'Normal'], [1.5, 'Rápida'], [2, 'Turbo']], current.animationSpeed, 'Velocidade das animações');
    speed.el.addEventListener('click', () => change('animationSpeed', speed.value));

    const sections = [
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Áudio')),
        toggle('Efeitos sonoros', 'Sons de cartas, estouros e vitórias', current.sound, (value) => {
          change('sound', value);
          if (value) F7.Sound.click();
        }),
        h('div', { class: 'setting' }, h('span', { class: 'setting__text' }, h('strong', {}, 'Volume'), h('small', {}, 'Volume geral dos efeitos')), h('span', { class: 'setting__range' }, volume, volumeValue)),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Visual')),
        h('div', { class: 'setting' }, h('span', { class: 'setting__text' }, h('strong', {}, 'Velocidade das animações'), h('small', {}, 'Vale para as partidas online')), speed.el),
        toggle('Reduzir movimento', 'Troca as animações por transições rápidas', current.reducedMotion, (value) => change('reducedMotion', value)),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Jogo')),
        toggle('Mostrar risco de estourar', 'Exibe a chance exata de repetir um número na próxima carta', current.showRisk, (value) => change('showRisk', value)),
      ),
    ];

    if (F7.Auth.mode === 'supabase') {
      const { field } = F7.Screens;
      const password = field('Nova senha', { type: 'password', autocomplete: 'new-password', minlength: 6 }, 'Pelo menos 6 caracteres');
      const button = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Alterar senha');
      sections.push(
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'section-head' }, h('h2', {}, 'Conta')),
          h(
            'form',
            {
              class: 'form',
              onSubmit: (event) => {
                event.preventDefault();
                if (password.input.value.length < 6) return password.setNote('A senha precisa ter pelo menos 6 caracteres.', 'error');
                return App.busy(button, async () => {
                  await F7.Auth.updatePassword(password.input.value);
                  password.input.value = '';
                  password.setNote('');
                  App.toast('Senha alterada!', { variant: 'stay' });
                });
              },
            },
            password.el,
            button,
          ),
        ),
      );
    }

    App.render(
      h(
        'div',
        { class: 'profile' },
        h('div', { class: 'section-head' }, h('h1', {}, 'Ajustes'), saved),
        sections,
        h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: () => App.signOut() }, 'Sair da conta'),
      ),
      { narrow: true },
    );

    return () => clearTimeout(timer);
  }

  F7.Screens = Object.assign(F7.Screens || {}, { settings });
})(globalThis.F7 = globalThis.F7 || {});
