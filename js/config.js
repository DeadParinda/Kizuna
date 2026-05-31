import { state } from './state.js?v=11';

export const SB_URL  = 'https://xcguhjburistkqpfadcs.supabase.co';
window.SB_URL = SB_URL;

export const SB_ANON = 'sb_publishable_DyIm2CKsW9tZIYVqLpDf1g_Ti2OTTDs';
window.SB_ANON = SB_ANON;

export const GIPHY_KEY = 'q1lL8A3rPdYwFDZDlBGXge6acvQ5DR4z';
window.GIPHY_KEY = GIPHY_KEY;

export const DEFAULT_ROOM = 'general';
window.DEFAULT_ROOM = DEFAULT_ROOM;

export const sb = supabase.createClient(SB_URL, SB_ANON);
window.sb = sb;

export const BASE_TITLE = 'Kizuna';
window.BASE_TITLE = BASE_TITLE;

export const ICE_CFG = {
  iceServers: [
    // STUN — direct connection attempt first
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },

    // TURN — fallback relay when direct fails
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all'   // normal
};
window.ICE_CFG = ICE_CFG;

export const HISTORY_MAX     = 80;
window.HISTORY_MAX = HISTORY_MAX;

export const TYPING_DEBOUNCE = 2500;
window.TYPING_DEBOUNCE = TYPING_DEBOUNCE;

export const SP_THRESH       = 3;
window.SP_THRESH = SP_THRESH;

export const CHUNK_SIZE      = 16000;
window.CHUNK_SIZE = CHUNK_SIZE;

export const PFP_COOLDOWN_DAYS = 5;
window.PFP_COOLDOWN_DAYS = PFP_COOLDOWN_DAYS;

export const PFP_LS_KEY      = 'kizuna_avatars';
window.PFP_LS_KEY = PFP_LS_KEY;

export const LS_MESSAGES     = 'kizuna_messages';
window.LS_MESSAGES = LS_MESSAGES;

export const LS_MEDIA        = 'meshchat_media_';
window.LS_MEDIA = LS_MEDIA;

export const SB_TABLE_HIST   = 'meshchat_history';
window.SB_TABLE_HIST = SB_TABLE_HIST;

export const BASE_CDN = 'https://bcycofacmwmmqisdbkdt.supabase.co/storage/v1/object/public/buck/pfps';
window.BASE_CDN = BASE_CDN;

export const AVATAR_CATS = [
  { id:'zombie_land_saga',      label:'ZLS',        name:'Zombie Land Saga',        ext:'png', count:7  },
  { id:'wind_breaker',          label:'Wind Brk',   name:'Wind Breaker',            ext:'jpg', count:12 },
  { id:'the_apothecary_diaries',label:'Apoth.',     name:'The Apothecary Diaries',  ext:'png', count:8  },
  { id:'spy_x_family',          label:'Spy×Fam',    name:'Spy × Family',            ext:'png', count:5  },
  { id:'solo_leveling',         label:'Solo Lv.',   name:'Solo Leveling',           ext:'png', count:5  },
  { id:'shikanoko',             label:'Shikanoko',  name:'My Deer Friend Nokotan',  ext:'png', count:7  },
  { id:'oshi_no_ko',            label:'Oshi no Ko', name:'Oshi no Ko',              ext:'png', count:9  },
  { id:'jjk',                   label:'JJK',        name:'Jujutsu Kaisen',          ext:'png', count:5  },
  { id:'mha',                   label:'MHA',        name:'My Hero Academia',        ext:'png', count:10 },
  { id:'kaiju_no_8',            label:'Kaiju #8',   name:'Kaiju No. 8',             ext:'png', count:13 },
  { id:'bocchi_the_rock',       label:'Bocchi',     name:'Bocchi the Rock!',        ext:'png', count:8  },
];
window.AVATAR_CATS = AVATAR_CATS;

