import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MarketAlerts} from './MarketAlerts';
it('provides an honest signed-out state and a review-first signed-in form',()=>{const guest=renderToStaticMarkup(<MarketAlerts client={null} active/>);expect(guest).toContain('Sign in to create alerts');const member=renderToStaticMarkup(<MarketAlerts client={{} as any} active/>);expect(member).toContain('Review with VIBES');expect(member).toContain('Connect Telegram');expect(member).toContain('No alerts yet');expect(member).toContain('BiQuote live alerts');});
