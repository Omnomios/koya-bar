import { textInput } from './text-input.js';

export const passwordInput = (win, options) => textInput(win, { placeholder: 'Password', ...options, password: true });
