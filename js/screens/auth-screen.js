/**
 * Vira-7 — Telas de conta: entrar, criar conta, recuperar e redefinir a senha.
 */
((F7) => {
  'use strict';

  const { h } = F7.dom;
  const { icon } = F7.icons;
  const App = F7.App;

  /** Campo de formulário com rótulo, dica e mensagem de erro. */
  function field(label, attrs, hint = '') {
    const input = h('input', { class: 'field', ...attrs });
    const note = h('small', { class: 'form__hint' }, hint);
    const el = h('label', { class: 'form__field' }, h('span', { class: 'form__label' }, label), input, note);
    const setNote = (text, kind = '') => {
      note.textContent = text || hint;
      note.className = `form__hint ${kind ? `is-${kind}` : ''}`;
      input.setAttribute('aria-invalid', String(kind === 'error'));
    };
    return { el, input, setNote };
  }

  /**
   * Moldura das telas de conta: a marca de um lado, o formulário do outro
   * (no celular, a marca vira uma faixa no topo).
   */
  function shell(title, subtitle, ...content) {
    const dev = F7.Api.config && F7.Api.config.devMode;
    const parade = ['raposa', 'panda', 'sapo', 'coruja', 'leao', 'pinguim'];
    return h(
      'div',
      { class: 'auth' },
      h(
        'aside',
        { class: 'auth__brand' },
        h('div', { class: 'logo logo--light' }, h('span', { class: 'logo__word' }, 'VIRA'), h('span', { class: 'logo__seven' }, '7')),
        h('p', { class: 'auth__headline' }, 'Vire. Some. ', h('em', {}, 'Pare antes de estourar.')),
        h(
          'div',
          { class: 'auth__parade', 'aria-hidden': 'true' },
          parade.map((key, i) =>
            h('span', {
              class: 'avatar avatar--animal',
              html: F7.Avatars.svg(key),
              style: { '--avatar-color': F7.Avatars.info(key).color, '--i': i },
            }),
          ),
        ),
        h(
          'ul',
          { class: 'auth__points' },
          h('li', {}, 'Partidas online de 2 a 8 jogadores'),
          h('li', {}, 'Salas com código para chamar os amigos'),
          h('li', {}, 'Ranking, histórico e 10 bichinhos para escolher'),
        ),
      ),
      h(
        'section',
        { class: 'auth__side' },
        h('div', { class: 'auth__card' }, h('h1', {}, title), subtitle ? h('p', { class: 'auth__subtitle' }, subtitle) : null, content),
        dev
          ? h('p', { class: 'auth__dev' }, 'Modo de desenvolvimento local: as contas existem só enquanto o servidor estiver ligado.')
          : null,
        h('a', { class: 'auth__local', href: '#/local' }, 'Jogar sem conta, na mesma tela'),
        h('a', { class: 'auth__local', href: '#/tutorial' }, 'Aprender a jogar (tutorial)'),
      ),
    );
  }

  const message = (text, kind = 'error') => h('p', { class: `form__message is-${kind}`, role: 'alert' }, text);

  /* ------------------------------------------------------------------ */

  function login() {
    const email = field('E-mail', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'voce@exemplo.com' });
    const password = field('Senha', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, minlength: 6 });
    const feedback = h('div');
    const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--lg btn--block' }, 'Entrar');

    const form = h(
      'form',
      {
        class: 'form',
        novalidate: true,
        onSubmit: (event) => {
          event.preventDefault();
          F7.Sound.unlock();
          feedback.replaceChildren();
          App.busy(submit, async () => {
            try {
              await F7.Auth.signIn({ email: email.input.value.trim(), password: password.input.value });
            } catch (error) {
              feedback.replaceChildren(message(error.message));
            }
          });
        },
      },
      email.el,
      password.el,
      feedback,
      submit,
      h(
        'div',
        { class: 'form__links' },
        h('a', { href: '#/recuperar' }, 'Esqueci minha senha'),
        h('a', { href: '#/cadastro' }, 'Criar uma conta'),
      ),
    );

    // Atalhos sem senha: convidado (jogar já) e Google. Só aparecem quando o servidor os liga.
    const config = F7.Api.config || {};
    const shortcut = (label, iconName, action, className = '') => {
      const button = h('button', { type: 'button', class: `btn btn--block ${className}` }, h('span', { html: F7.icons.icon(iconName) }), label);
      button.addEventListener('click', () => {
        F7.Sound.unlock();
        feedback.replaceChildren();
        App.busy(button, async () => {
          try {
            await action();
          } catch (error) {
            feedback.replaceChildren(message(error.message));
          }
        });
      });
      return button;
    };
    const shortcuts = [];
    if (config.googleLogin) shortcuts.push(shortcut('Entrar com Google', 'user', () => F7.Auth.signInGoogle(), 'btn--google'));
    if (config.guestLogin) shortcuts.push(shortcut('Entrar como convidado', 'play', () => F7.Auth.signInGuest(), 'btn--ghost'));
    const extras = shortcuts.length
      ? h('div', { class: 'auth__shortcuts' }, h('span', { class: 'auth__or' }, 'ou'), shortcuts, config.guestLogin ? h('small', { class: 'form__hint' }, 'Convidados jogam na hora e podem criar a conta depois, sem perder as partidas.') : null)
      : null;
    App.render(shell('Entrar', 'Que bom ver você de novo.', form, extras), { nav: false, bare: true });
    email.input.focus();
  }

  function signup() {
    const username = field('Nome de usuário', { type: 'text', name: 'username', autocomplete: 'username', maxlength: 20, required: true, placeholder: 'ex.: gabriel_7' }, '3 a 20 letras, números ou _');
    const email = field('E-mail', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'voce@exemplo.com' });
    const password = field('Senha', { type: 'password', name: 'password', autocomplete: 'new-password', required: true, minlength: 6 }, 'Pelo menos 6 caracteres');
    const picker = F7.Avatars.picker({ value: F7.Avatars.KEYS[Math.floor(Math.random() * F7.Avatars.KEYS.length)] });
    const feedback = h('div');
    const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--lg btn--block' }, 'Criar conta');

    let timer = null;
    let available = false;
    username.input.addEventListener('input', () => {
      clearTimeout(timer);
      available = false;
      const value = username.input.value.trim();
      if (value.length < 3) return username.setNote('');
      timer = setTimeout(async () => {
        try {
          const result = await F7.Api.request('GET', `/usernames/${encodeURIComponent(value)}/available`, undefined, { auth: false });
          if (username.input.value.trim() !== value) return;
          available = result.available;
          username.setNote(result.available ? 'Nome disponível ✓' : result.reason, result.available ? 'ok' : 'error');
        } catch (error) {
          username.setNote('');
        }
      }, 350);
      return undefined;
    });

    const form = h(
      'form',
      {
        class: 'form',
        novalidate: true,
        onSubmit: (event) => {
          event.preventDefault();
          F7.Sound.unlock();
          feedback.replaceChildren();
          const data = {
            username: username.input.value.trim(),
            email: email.input.value.trim(),
            password: password.input.value,
            avatar: picker.value,
          };
          if (!/^[A-Za-z0-9_]{3,20}$/.test(data.username)) {
            username.setNote('Use de 3 a 20 letras, números ou _.', 'error');
            return username.input.focus();
          }
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
            email.setNote('Digite um e-mail válido.', 'error');
            return email.input.focus();
          }
          if (data.password.length < 6) {
            password.setNote('A senha precisa ter pelo menos 6 caracteres.', 'error');
            return password.input.focus();
          }
          return App.busy(submit, async () => {
            try {
              const result = await F7.Auth.signUp(data);
              if (result.needsConfirmation) {
                App.render(
                  shell(
                    'Confirme seu e-mail',
                    null,
                    h('div', { class: 'auth__notice' },
                      h('span', { class: 'auth__notice-icon', html: icon('sparkles') }),
                      h('p', {}, 'Enviamos um link de confirmação para ', h('strong', {}, data.email), '. Abra o e-mail e clique no link para ativar sua conta.'),
                    ),
                    h('a', { class: 'btn btn--primary btn--block', href: '#/entrar' }, 'Já confirmei, quero entrar'),
                  ),
                  { nav: false, bare: true },
                );
              }
            } catch (error) {
              feedback.replaceChildren(message(error.message));
            }
          });
        },
      },
      username.el,
      email.el,
      password.el,
      h('div', { class: 'form__field' }, h('span', { class: 'form__label' }, 'Escolha seu personagem'), picker.el),
      feedback,
      submit,
      h('div', { class: 'form__links' }, h('span', {}, 'Já tem conta?'), h('a', { href: '#/entrar' }, 'Entrar')),
    );
    App.render(shell('Criar conta', 'Leva um minuto. Suas vitórias ficam guardadas.', form), { nav: false, bare: true });
    username.input.focus();
  }

  function forgot() {
    const email = field('E-mail da sua conta', { type: 'email', name: 'email', autocomplete: 'email', required: true });
    const feedback = h('div');
    const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--lg btn--block' }, 'Enviar link de recuperação');
    const form = h(
      'form',
      {
        class: 'form',
        novalidate: true,
        onSubmit: (event) => {
          event.preventDefault();
          feedback.replaceChildren();
          App.busy(submit, async () => {
            try {
              await F7.Auth.sendRecovery(email.input.value.trim());
              feedback.replaceChildren(
                message('Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha.', 'ok'),
              );
            } catch (error) {
              feedback.replaceChildren(message(error.message));
            }
          });
        },
      },
      email.el,
      feedback,
      submit,
      h('div', { class: 'form__links' }, h('a', { href: '#/entrar' }, '← Voltar para entrar')),
    );
    App.render(shell('Recuperar senha', 'Enviaremos um link para o seu e-mail.', form), { nav: false, bare: true });
    email.input.focus();
  }

  function reset() {
    const password = field('Nova senha', { type: 'password', autocomplete: 'new-password', required: true, minlength: 6 }, 'Pelo menos 6 caracteres');
    const confirm = field('Repita a nova senha', { type: 'password', autocomplete: 'new-password', required: true, minlength: 6 });
    const feedback = h('div');
    const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--lg btn--block' }, 'Salvar nova senha');
    const form = h(
      'form',
      {
        class: 'form',
        novalidate: true,
        onSubmit: (event) => {
          event.preventDefault();
          feedback.replaceChildren();
          if (password.input.value.length < 6) return password.setNote('A senha precisa ter pelo menos 6 caracteres.', 'error');
          if (password.input.value !== confirm.input.value) return confirm.setNote('As senhas não são iguais.', 'error');
          return App.busy(submit, async () => {
            try {
              await F7.Auth.updatePassword(password.input.value);
              App.toast('Senha alterada com sucesso!', { variant: 'stay' });
              App.navigate('/');
            } catch (error) {
              feedback.replaceChildren(message(error.message));
            }
          });
        },
      },
      password.el,
      confirm.el,
      feedback,
      submit,
    );
    App.render(shell('Criar nova senha', 'Escolha uma senha nova para a sua conta.', form), { nav: false, bare: true });
    password.input.focus();
  }

  /** Tela exibida quando a API não responde: só o jogo local está disponível. */
  function offline() {
    App.render(
      shell(
        'Sem conexão com o servidor',
        'Não foi possível falar com a API do jogo. O modo online fica indisponível, mas você ainda pode jogar na mesma tela.',
        h('a', { class: 'btn btn--primary btn--lg btn--block', href: '#/local' }, 'Jogar na mesma tela'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: () => window.location.reload() }, 'Tentar de novo'),
      ),
      { nav: false, bare: true },
    );
  }

  F7.Screens = Object.assign(F7.Screens || {}, { login, signup, forgot, reset, offline, field });
})(globalThis.F7 = globalThis.F7 || {});
