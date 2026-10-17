import { system } from 'Module/dbus';
import { createAccountsService } from './accounts-model.js';

export const accounts = createAccountsService(system);
