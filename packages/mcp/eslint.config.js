import { config } from '@selvajs/config/eslint';

export default [...config, { ignores: ['dist/', 'coverage/'] }];
