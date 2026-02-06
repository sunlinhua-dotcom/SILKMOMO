export interface StyleConfig {
    id: string;
    name: string;
    description: string;
    coverImage: string; // We'll use placeholder colors or descriptions for now
    prompts: {
        hero: string;      // 1:1 
        full_body: string; // 3:4
        half_body: string; // 3:4
        close_up: string;  // 3:4
    };
    waitingMessages: string[];
}

const COMMON_FILM_PROMPT = "Shot on Kodak Portra 400, 35mm film grain, soft focus, cinematic lighting, high fashion editorial, dreamy atmosphere, slightly overexposed highlights, natural skin texture.";

export const STYLES: StyleConfig[] = [
    {
        id: 'french_garden',
        name: '法式庭院',
        description: '午后慵懒的法式公寓与花园',
        coverImage: '/styles/french.jpg',
        prompts: {
            hero: `A cinematic film shot of a young woman wearing [Product Description] reclining in a white slipcover armchair in a vintage French apartment. Open French doors reveal a lush green garden. Warm afternoon sunlight, sun-drenched. She looks relaxed, unbothered, reading a book. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is standing by the open garden door, looking outside, back slightly turned to show the back details of the silk robe. Soft breeze blowing the fabric. Vintage parquet floor. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. The model is leaning against the door frame, holding a cup of tea, looking at the camera with a lazy, romantic expression. Messy bun hair style with a silk ribbon. ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of the [Product Description] fabric texture in the sunlight. The model's hand is resting on the fabric. Soft focus background of greenery. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在布置法式庭院的下午茶...",
            "调整午后的阳光角度...",
            "装填 Kodak Portra 400 胶卷..."
        ]
    },
    {
        id: 'lazy_morning',
        name: '清晨柔光',
        description: '白色床单与透过纱帘的晨光',
        coverImage: '/styles/morning.jpg',
        prompts: {
            hero: `A intimate film shot of a woman in [Product Description] sitting on a messy bed with white linens. Soft morning sunlight streaming through sheer curtains, creating gentle shadows. She is stretching or fixing her hair. Cozy, comfortable, authentic. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is walking barefoot on a fluffy rug near the bed. The silk robe flows naturally. Bright, airy, and fresh bedroom atmosphere. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. The model is sitting on the edge of the bed, looking down or smiling softly. Soft backlight halo effect on her hair. Skin texture is natural and glowing. ${COMMON_FILM_PROMPT}`,
            close_up: `Close up on the [Product Description] lace or silk details against the white bed sheets. Soft depth of field. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在拉开清晨的窗帘...",
            "整理柔软的床铺...",
            "捕捉第一缕晨光..."
        ]
    },
    {
        id: 'hotel_luxury',
        name: '高奢酒店',
        description: '五星级酒店套房的精致夜晚',
        coverImage: '/styles/hotel.jpg',
        prompts: {
            hero: `A sophisticated film shot of a woman in [Product Description] standing near a floor-to-ceiling window in a luxury hotel suite. City lights bokeh in the background (night time). Elegant interior, warm ambient lighting. She holds a glass of champagne. Expensive, chic. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is lounging on a velvet chaise longue. The silk sheen reflects the city lights. High-end furniture. Confident and alluring pose. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. Reflection in a large mirror or window. Moody lighting. The model looks effortless and wealthy. ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of the silk draping over the velvet furniture. High contrast between the textures. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在办理入住五星级套房...",
            "准备香槟和城市夜景...",
            "调整室内氛围灯光..."
        ]
    },
    {
        id: 'oriental_zen',
        name: '东方新中式',
        description: '木质格栅与茶室的静谧时光',
        coverImage: '/styles/zen.jpg',
        prompts: {
            hero: `A serene film shot of a woman in [Product Description] sitting in a modern oriental tea room. Wooden lattice screens (shoji), bamboo shadows cast on the wall. Soft, diffused lantern light. She is pouring tea or arranging flowers. Peaceful, elegant, heritage. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is standing next to a bonsai tree or wooden screen. The silhouette of the silk robe is highlighted. Minimalist composition. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. Profile view. The model looks contemplative. Soft shadow patterns on her face and the silk fabric. Aesthetic of Wong Kar-wai films but brighter. ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of the silk texture next to a ceramic tea cup or wooden texture. Contrast of materials. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在点燃沉香...",
            "布置中式木格栅光影...",
            "准备茶席..."
        ]
    },
    {
        id: 'private_spa',
        name: '私享 SPA',
        description: '大理石浴室与护肤时刻',
        coverImage: '/styles/spa.jpg',
        prompts: {
            hero: `A clean, spa-like film shot of a woman in [Product Description] in a luxury bathroom. White marble walls, steam, a large bathtub. She is applying skincare or checking the mirror. Clean, pure, wellness vibe. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is sitting on the edge of the bathtub. Tiled floor. Soft, flattering vanity lighting. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. The model is wrapping the robe around herself, smiling. Fresh faced, 'clean girl' aesthetic. ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of water droplets or steam on the background, with the dry silk fabric in focus. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在放满热水的浴缸...",
            "点燃精油香薰...",
            "营造浴室的水雾感..."
        ]
    },
    {
        id: 'romantic_night',
        name: '烛光之夜',
        description: '昏暗卧室与浪漫烛光',
        coverImage: '/styles/romantic.jpg',
        prompts: {
            hero: `A romantic, moody film shot of a woman in [Product Description] in a dim bedroom. Lit only by candles and a warm bedside lamp. Deep shadows, rich colors. She is sitting on the bed, looking mysterious. Satin sheen is emphasized. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is standing in the shadows, silhouette outlined by the warm light. Seductive and elegant. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. The model is looking over her shoulder. Soft blur of candles in the foreground. ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of the fabric ripples in the low light. Gold jewelry accents. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在点亮蜡烛...",
            "倒一杯红酒...",
            "调暗灯光..."
        ]
    },
    {
        id: 'manor_library',
        name: '庄园书房',
        description: '深色木质书房与老钱风',
        coverImage: '/styles/library.jpg',
        prompts: {
            hero: `A classic 'old money' aesthetic film shot of a woman in [Product Description] in a vintage manor library. Dark wood paneling, bookshelves, Persian rug. She is sitting in a leather or velvet wingback chair reading a hardcover book. Intellectual, timeless. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is standing by a heavy wooden desk or bookshelf. Warm, library lamp lighting. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. The model is holding glasses or a pen, looking intelligent and relaxed. Rich textures of wood and silk. ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of the silk robe arm resting on an old book or antique desk. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在整理古董书架...",
            "擦拭红木书桌...",
            "调整阅读灯光..."
        ]
    },
    {
        id: 'vacation_villa',
        name: '度假别墅',
        description: '海景阳台与假日微风',
        coverImage: '/styles/vacation.jpg',
        prompts: {
            hero: `A holiday vibe film shot of a woman in [Product Description] on a balcony of a Mediterranean villa. Blue ocean or pool visible in the background. Bright, hard sunlight (golden hour), deep blue sky. She is leaning on the railing, enjoying the breeze. Vacation mode. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is walking near white stucco walls. The wind is catching the silk fabric. Dynamic and free. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. The model is wearing sunglasses (optional) or holding a hat. Sun-kissed skin. ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of the fabric against a white stone texture or blue water background. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在吹过海风...",
            "调整遮阳伞...",
            "捕捉海浪的声音..."
        ]
    },
    {
        id: 'minimalist_home',
        name: '极简居家',
        description: '米色调的侘寂风空间',
        coverImage: '/styles/minimalist.jpg',
        prompts: {
            hero: `A clean, minimalist film shot of a woman in [Product Description] in a room with beige plaster walls (wabi-sabi style). Dried flowers, linen sofa, natural wood. Soft, diffused daylight. No clutter. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is standing in an empty corner of the room. Artistic composition, focus on lines and form. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. The model is looking away peacefully. Neutral color palette (beige, cream, white). ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of the silk texture against a rough plaster wall or linen fabric. Texture contrast. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在清空杂物...",
            "摆放干花...",
            "调整柔和漫射光..."
        ]
    },
    {
        id: 'bridal_morning',
        name: '晨袍时刻',
        description: '婚礼当日的化妆间',
        coverImage: '/styles/bridal.jpg',
        prompts: {
            hero: `A celebratory film shot of a woman in [Product Description] (white or pastel) in a bright makeup room. Vanity mirror with lights, bouquets of flowers, champagne glass. She looks happy, excited. 'Getting ready' bride vibe. ${COMMON_FILM_PROMPT}`,
            full_body: `Full body shot. The model is spinning or holding the robe hem. Joyful movement. High key lighting. ${COMMON_FILM_PROMPT}`,
            half_body: `Medium shot. The model is applying lipstick or looking in the mirror. Reflection shot. ${COMMON_FILM_PROMPT}`,
            close_up: `Detail shot of the robe details next to a bouquet of white roses. ${COMMON_FILM_PROMPT}`
        },
        waitingMessages: [
            "正在准备手捧花...",
            "倒满香槟...",
            "调试化妆镜灯光..."
        ]
    }
];

export const DEFAULT_STYLE = STYLES[0]; // French Garden as default
