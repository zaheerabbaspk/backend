const axios = require('axios');

const BASE_URL = 'https://api.cricapi.com/v1';
const REFRESH_INTERVAL_MS = 30000; // Poll every 30 seconds for live updates

// =============================================
// ODDS GENERATOR — Produces realistic odds from
// match state (score, run-rate, wickets, etc.)
// =============================================
function generateOddsForTeams(match, team1Name, team2Name) {
    let team1Back = 1.90, team1Lay = 1.95;
    let team2Back = 2.05, team2Lay = 2.10;

    try {
        // Use score data to tilt odds if available
        const score = match.score || [];
        if (score.length >= 2) {
            const s1 = score[0]; // Team 1 innings
            const s2 = score[1]; // Team 2 innings (or current)

            const r1 = s1.r || 0;
            const w1 = s1.w || 0;
            const ov1 = parseFloat(s1.o) || 1;

            const r2 = s2.r || 0;
            const w2 = s2.w || 0;
            const ov2 = parseFloat(s2.o) || 1;

            const rr1 = r1 / ov1;
            const rr2 = r2 / ov2;

            // Tilt odds based on run rate advantage
            if (rr2 > rr1 + 2) {
                // Team 2 dominating
                team1Back = 2.80; team1Lay = 2.90;
                team2Back = 1.45; team2Lay = 1.50;
            } else if (rr1 > rr2 + 2) {
                // Team 1 dominating
                team1Back = 1.45; team1Lay = 1.50;
                team2Back = 2.80; team2Lay = 2.90;
            } else if (rr2 > rr1) {
                team1Back = 2.10; team1Lay = 2.15;
                team2Back = 1.75; team2Lay = 1.80;
            } else {
                team1Back = 1.75; team1Lay = 1.80;
                team2Back = 2.10; team2Lay = 2.15;
            }

            // Wickets adjustment — losing wickets shifts odds
            if (w2 >= 7) {
                team2Back = Math.min(team2Back * 1.4, 9.0);
                team2Lay = Math.min(team2Lay * 1.4, 9.5);
                team1Back = Math.max(team1Back * 0.75, 1.10);
                team1Lay = Math.max(team1Lay * 0.75, 1.12);
            }
        }
    } catch (e) {
        // Odds stay at defaults if score not parseable
    }

    // Round to 2 decimal places
    const r = (v) => Math.round(v * 100) / 100;

    return {
        team1: {
            back: [
                { price: r(team1Back - 0.04), size: '45K' },
                { price: r(team1Back - 0.02), size: '120K' },
                { price: r(team1Back), size: '320K' }
            ],
            lay: [
                { price: r(team1Lay), size: '280K' },
                { price: r(team1Lay + 0.02), size: '95K' },
                { price: r(team1Lay + 0.04), size: '40K' }
            ]
        },
        team2: {
            back: [
                { price: r(team2Back - 0.04), size: '40K' },
                { price: r(team2Back - 0.02), size: '100K' },
                { price: r(team2Back), size: '250K' }
            ],
            lay: [
                { price: r(team2Lay), size: '230K' },
                { price: r(team2Lay + 0.02), size: '80K' },
                { price: r(team2Lay + 0.04), size: '35K' }
            ]
        }
    };
}

// =============================================
// MAP raw CricAPI match → Exchange Market shape
// =============================================
function mapCricApiMatchToMarket(match) {
    const teams = match.teams || [];
    const team1 = teams[0] || 'Team A';
    const team2 = teams[1] || 'Team B';

    const odds = generateOddsForTeams(match, team1, team2);

    // Determine status
    let status = 'OPEN';
    if (match.matchStarted && !match.matchEnded) status = 'LIVE';
    else if (match.matchEnded) status = 'CLOSED';

    // Build runners
    const runners = [
        {
            id: `${match.id}_r0`,
            name: team1,
            odds: { back: odds.team1.back, lay: odds.team1.lay }
        },
        {
            id: `${match.id}_r1`,
            name: team2,
            odds: { back: odds.team2.back, lay: odds.team2.lay }
        }
    ];

    // Score summary string
    const scoreStr = (match.score || [])
        .map(s => `${s.inning}: ${s.r}/${s.w} (${s.o} ov)`)
        .join(' | ');

    return {
        id: match.id,
        sport: 'cricket',
        tournament: match.name || match.series_id || 'IPL 2025',
        startTime: match.dateTimeGMT || new Date().toISOString(),
        status,
        remainingTime: match.timeRemaining || '00:00:00',
        venue: match.venue || '',
        scoreInfo: scoreStr,
        teams: { team1, team2 },
        runners,
        winner_runner_id: null,
        isLive: status === 'LIVE',
        rawMatch: match  // Keep raw data for debugging
    };
}

// =============================================
// FALLBACK MOCK DATA  (used when API key missing / offline)
// =============================================
const MOCK_IPL_MARKETS = [
    {
        id: 'ipl_mock_1',
        sport: 'cricket',
        tournament: 'IPL 2025 — Mumbai Indians vs Chennai Super Kings',
        startTime: new Date().toISOString(),
        status: 'LIVE',
        remainingTime: '14:35:00',
        venue: 'Wankhede Stadium, Mumbai',
        scoreInfo: 'MI 1st innings: 187/4 (20 ov) | CSK 1st innings: 142/6 (16.3 ov)',
        isLive: true,
        runners: [
            {
                id: 'ipl_mock_1_r0',
                name: 'Mumbai Indians',
                odds: {
                    back: [{ price: 1.32, size: '280K' }, { price: 1.33, size: '150K' }, { price: 1.35, size: '90K' }],
                    lay:  [{ price: 1.36, size: '200K' }, { price: 1.38, size: '80K' }, { price: 1.40, size: '30K' }]
                }
            },
            {
                id: 'ipl_mock_1_r1',
                name: 'Chennai Super Kings',
                odds: {
                    back: [{ price: 3.20, size: '100K' }, { price: 3.25, size: '55K' }, { price: 3.30, size: '25K' }],
                    lay:  [{ price: 3.35, size: '75K' }, { price: 3.40, size: '30K' }, { price: 3.50, size: '15K' }]
                }
            }
        ],
        winner_runner_id: null
    },
    {
        id: 'ipl_mock_2',
        sport: 'cricket',
        tournament: 'IPL 2025 — Royal Challengers Bengaluru vs Kolkata Knight Riders',
        startTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        status: 'OPEN',
        remainingTime: '02:00:00',
        venue: 'M Chinnaswamy Stadium, Bengaluru',
        scoreInfo: '',
        isLive: false,
        runners: [
            {
                id: 'ipl_mock_2_r0',
                name: 'Royal Challengers Bengaluru',
                odds: {
                    back: [{ price: 1.85, size: '150K' }, { price: 1.87, size: '80K' }, { price: 1.90, size: '40K' }],
                    lay:  [{ price: 1.92, size: '120K' }, { price: 1.95, size: '60K' }, { price: 1.98, size: '25K' }]
                }
            },
            {
                id: 'ipl_mock_2_r1',
                name: 'Kolkata Knight Riders',
                odds: {
                    back: [{ price: 2.05, size: '130K' }, { price: 2.08, size: '70K' }, { price: 2.10, size: '35K' }],
                    lay:  [{ price: 2.12, size: '100K' }, { price: 2.15, size: '50K' }, { price: 2.18, size: '20K' }]
                }
            }
        ],
        winner_runner_id: null
    },
    {
        id: 'ipl_mock_3',
        sport: 'cricket',
        tournament: 'IPL 2025 — Rajasthan Royals vs Sunrisers Hyderabad',
        startTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
        status: 'OPEN',
        remainingTime: '05:00:00',
        venue: 'Sawai Mansingh Stadium, Jaipur',
        scoreInfo: '',
        isLive: false,
        runners: [
            {
                id: 'ipl_mock_3_r0',
                name: 'Rajasthan Royals',
                odds: {
                    back: [{ price: 1.95, size: '200K' }, { price: 1.97, size: '100K' }, { price: 2.00, size: '50K' }],
                    lay:  [{ price: 2.02, size: '180K' }, { price: 2.05, size: '90K' }, { price: 2.08, size: '40K' }]
                }
            },
            {
                id: 'ipl_mock_3_r1',
                name: 'Sunrisers Hyderabad',
                odds: {
                    back: [{ price: 1.95, size: '190K' }, { price: 1.97, size: '95K' }, { price: 2.00, size: '45K' }],
                    lay:  [{ price: 2.02, size: '170K' }, { price: 2.05, size: '85K' }, { price: 2.08, size: '38K' }]
                }
            }
        ],
        winner_runner_id: null
    }
];

// =============================================
// CRICKET API SERVICE
// =============================================
class CricketApiService {
    constructor() {
        this.apiKey = process.env.CRICAPI_KEY || '';
        this.cache = {
            liveMatches: [],
            lastFetched: null,
            isRefreshing: false
        };
        this.io = null;
        this.pollingTimer = null;

        if (this.apiKey && this.apiKey !== 'YOUR_CRICAPI_KEY_HERE') {
            console.log('[CricketAPI] API key found — live IPL data enabled ✅');
            this.startPolling();
        } else {
            console.warn('[CricketAPI] No valid API key found. Using fallback mock IPL data. Add CRICAPI_KEY to .env');
            this.cache.liveMatches = MOCK_IPL_MARKETS;
            this.cache.lastFetched = new Date();
        }
    }

    setIo(io) {
        this.io = io;
    }

    // ---- Fetch from CricAPI and cache ----
    async fetchLiveMatches() {
        if (this.cache.isRefreshing) return;
        this.cache.isRefreshing = true;

        try {
            console.log('[CricketAPI] Fetching live matches from CricAPI...');

            const response = await axios.get(`${BASE_URL}/currentMatches`, {
                params: { apikey: this.apiKey, offset: 0 },
                timeout: 10000
            });

            if (!response.data || response.data.status !== 'success') {
                throw new Error(`CricAPI error: ${response.data?.reason || 'unknown'}`);
            }

            const allMatches = response.data.data || [];

            // Filter: only matches with 2+ teams
            const cricketMatches = allMatches.filter(m => m.teams && m.teams.length >= 2);

            // Sort: in-progress live first, then ended today, then older
            cricketMatches.sort((a, b) => {
                const aLive  = a.matchStarted && !a.matchEnded ? 0 : 1;
                const bLive  = b.matchStarted && !b.matchEnded ? 0 : 1;
                if (aLive !== bLive) return aLive - bLive;
                // then sort by date descending (most recent first)
                return new Date(b.dateTimeGMT || 0) - new Date(a.dateTimeGMT || 0);
            });

            // Take top 15 matches
            const topMatches = cricketMatches.slice(0, 15);
            const markets    = topMatches.map(m => mapCricApiMatchToMarket(m));

            if (markets.length === 0) {
                console.warn('[CricketAPI] No matches found. Showing mock IPL data.');
                this.cache.liveMatches = MOCK_IPL_MARKETS;
            } else {
                this.cache.liveMatches = markets;
                const liveCount = markets.filter(m => m.status === 'LIVE').length;
                console.log(`[CricketAPI] ✅ Loaded ${markets.length} cricket markets (${liveCount} LIVE)`);
            }

            this.cache.lastFetched = new Date();

            // Push real-time update to connected clients
            if (this.io) {
                this.io.emit('markets_live_update', {
                    count:     this.cache.liveMatches.length,
                    liveCount: this.cache.liveMatches.filter(m => m.status === 'LIVE').length
                });
            }

        } catch (error) {
            console.error('[CricketAPI] Fetch error:', error.message);
            if (this.cache.liveMatches.length === 0) {
                console.warn('[CricketAPI] Falling back to mock IPL data.');
                this.cache.liveMatches = MOCK_IPL_MARKETS;
                this.cache.lastFetched = new Date();
            }
        } finally {
            this.cache.isRefreshing = false;
        }
    }

    // ---- Start background polling ----
    startPolling() {
        // Fetch immediately on startup
        this.fetchLiveMatches();

        // Then poll every 30 seconds
        this.pollingTimer = setInterval(() => {
            this.fetchLiveMatches();
        }, REFRESH_INTERVAL_MS);

        console.log(`[CricketAPI] Live polling started — refreshing every ${REFRESH_INTERVAL_MS / 1000}s`);
    }

    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    }

    // ---- Public API ----

    // Get all cached markets (live + upcoming)
    getMarkets() {
        // If using API key but no data yet, return mock while loading
        if (this.cache.liveMatches.length === 0) {
            return MOCK_IPL_MARKETS;
        }
        return this.cache.liveMatches;
    }

    // Get a single market by id
    getMarketById(marketId) {
        return this.cache.liveMatches.find(m => m.id === marketId) || null;
    }

    // Get last refresh timestamp
    getLastFetchTime() {
        return this.cache.lastFetched;
    }

    // Manually trigger a refresh (e.g. from admin panel)
    async forceRefresh() {
        await this.fetchLiveMatches();
        return { success: true, lastFetched: this.cache.lastFetched, count: this.cache.liveMatches.length };
    }
}

module.exports = new CricketApiService();
