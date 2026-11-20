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

    const T = (text) => F7.i18n.t(text);

    const theme = F7.Screens.segmented([['light', 'Claro'], ['dark', 'Escuro'], ['auto', 'Automático']], current.theme, 'Tema');
    theme.el.addEventListener('click', () => change('theme', theme.value));

    /** Amostras clicáveis (mesa ou verso de carta). `decorate(button, value)` desenha o conteúdo. */
    const swatches = (label, options, selected, key, decorate) => {
      const root = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': label });
      const buttons = options.map(([value, name]) => {
        const button = h('button', { type: 'button', role: 'radio', class: 'swatch', 'aria-checked': String(value === selected), 'aria-label': name }, h('span', {}, name));
        decorate(button, value);
        button.addEventListener('click', () => {
          buttons.forEach((b) => b.setAttribute('aria-checked', 'false'));
          button.setAttribute('aria-checked', 'true');
          F7.Sound.click();
          change(key, value);
        });
        root.appendChild(button);
        return button;
      });
      return root;
    };
    const TABLE_COLORS = { felt: '#20a070', wood: '#b87a4b', ocean: '#2f86d6', night: '#5b4aa8' };
    const tableSwatches = swatches(
      'Mesa',
      [['felt', 'Feltro'], ['wood', 'Madeira'], ['ocean', 'Oceano'], ['night', 'Noite']],
      current.tableTheme,
      'tableTheme',
      (button, value) => button.style.setProperty('--sw', TABLE_COLORS[value]),
    );
    const backSwatches = swatches(
      'Verso das cartas',
      [['classic', 'Clássico'], ['stripes', 'Listras'], ['dots', 'Bolinhas'], ['stars', 'Xadrez']],
      current.cardBack,
      'cardBack',
      (button, value) => {
        button.dataset.back = value;
        button.classList.add('swatch--back');
        button.prepend(F7.CardView.create(null, { size: 'xs', faceDown: true }));
      },
    );

    const language = F7.Screens.segmented([['pt', 'Português'], ['en', 'English'], ['es', 'Español']], F7.i18n.lang, 'Idioma');
    language.el.addEventListener('click', async () => {
      if (language.value === F7.i18n.lang) return;
      current.language = language.value;
      try {
        await F7.Api.put('/me/settings', { settings: current });
      } catch (error) {
        /* o idioma vale neste aparelho mesmo assim */
      }
      F7.i18n.set(language.value);
    });

    const installBox = h('div', { class: 'setting' });
    const paintInstall = () => {
      const status = F7.Pwa.status;
      installBox.hidden = status === 'none';
      installBox.innerHTML = '';
      const text = h('span', { class: 'setting__text' }, h('strong', {}, 'Instalar o app'), h('small', {}, status === 'installed' ? 'O Vira-7 já está instalado neste aparelho.' : status === 'ios' ? 'No Safari: toque em Compartilhar e depois em "Adicionar à Tela de Início".' : 'Ícone na tela inicial e tela cheia, sem barra do navegador.'));
      installBox.appendChild(text);
      if (status === 'available') installBox.appendChild(h('button', { type: 'button', class: 'btn btn--primary', onClick: () => F7.Pwa.install() }, 'Instalar'));
    };
    paintInstall();
    const stopInstall = F7.Pwa.onChange(paintInstall);

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
        h('div', { class: 'section-head' }, h('h2', {}, 'Aparência')),
        h('div', { class: 'setting setting--stack' }, h('span', { class: 'setting__text' }, h('strong', {}, 'Tema'), h('small', {}, 'Automático segue o modo do seu aparelho')), theme.el),
        h('div', { class: 'setting setting--stack' }, h('span', { class: 'setting__text' }, h('strong', {}, 'Mesa'), h('small', {}, 'A cor do feltro onde as cartas ficam')), tableSwatches),
        h('div', { class: 'setting setting--stack' }, h('span', { class: 'setting__text' }, h('strong', {}, 'Verso das cartas'), h('small', {}, 'O desenho do monte e das cartas viradas')), backSwatches),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Acessibilidade e celular')),
        toggle('Modo para daltônicos', 'Cores seguras e um símbolo em cada número, além da cor', current.colorblind, (value) => change('colorblind', value)),
        toggle(
          'Vibração',
          F7.Haptics.supported ? 'O celular vibra ao virar cartas, estourar e ganhar' : 'Este aparelho não vibra (comum em computadores e iPhone)',
          current.vibration && F7.Haptics.supported,
          (value) => {
            change('vibration', value);
            if (value) F7.Haptics.buzz('modifier');
          },
        ),
        toggle(
          'Mãos livres',
          F7.Voice.speechSupported
            ? F7.Voice.listenSupported
              ? 'O jogo narra a mesa e você joga falando "virar" ou "parar"'
              : 'O jogo narra a mesa em voz alta (seu navegador não ouve comandos de voz)'
            : 'Seu navegador não tem voz. Experimente o Chrome ou o Safari atuais.',
          current.handsFree && F7.Voice.speechSupported,
          (value) => {
            change('handsFree', value);
            if (value) F7.Voice.say(T('Modo mãos livres ligado.'), { urgent: true });
          },
        ),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Idioma')),
        h('div', { class: 'setting setting--stack' }, h('span', { class: 'setting__text' }, h('strong', {}, 'Idioma do jogo'), h('small', {}, 'A página recarrega ao trocar')), language.el),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Visual')),
        h('div', { class: 'setting setting--stack' }, h('span', { class: 'setting__text' }, h('strong', {}, 'Velocidade das animações'), h('small', {}, 'Vale para as partidas online')), speed.el),
        toggle('Reduzir movimento', 'Troca as animações por transições rápidas', current.reducedMotion, (value) => change('reducedMotion', value)),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Jogo')),
        toggle('Mostrar risco de estourar', 'Exibe a chance exata de repetir um número na próxima carta', current.showRisk, (value) => change('showRisk', value)),
        h('div', { class: 'setting' }, h('span', { class: 'setting__text' }, h('strong', {}, 'Tutorial interativo'), h('small', {}, 'Uma rodada de treino guiada, passo a passo')), h('a', { class: 'btn btn--ghost', href: '#/tutorial' }, 'Fazer o tutorial')),
        installBox,
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

    return () => {
      clearTimeout(timer);
      stopInstall();
    };
  }

  F7.Screens = Object.assign(F7.Screens || {}, { settings });
})(globalThis.F7 = globalThis.F7 || {});
