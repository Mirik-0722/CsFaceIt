# 1-quyi loyiha: FACEIT Analytics — Implementatsiya Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nickname kiritilganda o'yinchining ELO, Level, oxirgi matchlari va match statistikasi FACEIT Data API v4 dan olinib, Redis'da keshlanib, PostgreSQL'ga yozilib, React frontend va REST API orqali 2 soniyadan kam vaqtda ko'rsatiladi.

**Architecture:** Spring Boot backend FACEIT'ni `FaceitGateway` interfeysi orqali chaqiradi; `HttpFaceitGateway` (RestClient + retry + metrikalar) ustiga `CachingFaceitGateway` dekoratori (Redis, TTL + eskirgan nusxa) qo'yiladi. `PlayerService`/`MatchService` FACEIT javoblarini ichki DTO'larga aylantiradi va `players`/`matches`/`player_match_stats` jadvallarini upsert qiladi. React (Vite) frontend faqat backend REST'ni chaqiradi; Nginx statik fayllarni beradi va `/api/` ni backend'ga proksilaydi.

**Tech Stack:** Java 21, Spring Boot 3.5 (web, data-jpa, data-redis, validation, security, actuator), Spring Retry, Flyway, PostgreSQL 17, Redis 8, Micrometer/Prometheus, Testcontainers, WireMock 3, Maven; React 19, TypeScript, Vite, Tailwind v4, shadcn/ui, TanStack Query v5, react-router v7, Vitest, Testing Library, Playwright; Docker Compose, Nginx.

**Spec:** `docs/superpowers/specs/2026-10-08-faceit-cs2-analyzer-design.md` (5, 11, 12, 13, 14-bo'limlar; 1-quyi loyiha)

## Global Constraints

- Backend: Spring Boot 3.5, Java 21; PostgreSQL 17; Redis 8 (spec 4-bo'lim).
- FACEIT Data API v4: `https://open.faceit.com/data/v4`, sarlavha `Authorization: Bearer <API_KEY>`, kalit faqat `FACEIT_API_KEY` muhit o'zgaruvchisida (spec 5).
- Timeout: ulanish 5 s, o'qish 10 s. 429 va 5xx → eksponensial kechikish bilan 3 martagacha urinish, so'ng 502; keshda eskirgan nusxa bo'lsa — o'sha qaytariladi. FACEIT 404 → bizning 404, kod `PLAYER_NOT_FOUND` (match uchun `MATCH_NOT_FOUND`).
- Redis TTL: o'yinchi profili 5 daqiqa, history 2 daqiqa, **tugagan** match tafsilotlari/statistikasi 24 soat. Kalit formati `faceit:{resurs}:{id}`.
- Ichki endpointlar aynan: `GET /api/v1/players?nickname=`, `GET /api/v1/players/{playerId}`, `GET /api/v1/players/{playerId}/history`, `GET /api/v1/matches/{matchId}`, `GET /api/v1/matches/{matchId}/stats`.
- Sxema: Flyway `V1__init.sql` — `players`, `matches`, `player_match_stats`, `highlights` (spec 11). JPA `ddl-auto=validate`. Indekslar: `highlights(player_id, type)`, `player_match_stats(player_id)`.
- Sirlar faqat muhit o'zgaruvchilaridan; repoda faqat `.env.example`. GET endpointlar ochiq; boshqa barcha `/api/**` so'rovlar `X-API-Key` talab qiladi. CORS faqat frontend origin'iga. `nickname` uzunlik va belgilar bo'yicha tekshiriladi.
- Kuzatuvchanlik: Actuator + Micrometer → Prometheus; FACEIT so'rov kechikishi va xato soni metrikasi.
- Hujjat tili o'zbekcha; kod identifikatorlari, commit xabarlari va log matnlari inglizcha.

## Review Focus

Spec nazarda tutgan, lekin birorta vazifa testi avtomatik qamrab olmaydigan holatlar. Har biri uchun test egasi vazifaga qo'shilgan (qavs ichida).

1. **Noto'g'ri nickname** (`"a"`, 33+ belgi, `"<script>"`, bo'sh): 500 emas, `400 VALIDATION_ERROR` qaytishi kerak (Task 5, `invalidNicknameReturns400`).
2. **CS2 o'ynamagan o'yinchi** (FACEIT javobida `games.cs2` yo'q): NPE emas, `elo=null, level=null` bilan 200 (Task 3, `playerWithoutCs2HasNullEloAndLevel`).
3. **Tugamagan match** (`status != FINISHED`): 24 soatga keshlanmasligi kerak, aks holda yakuniy natija bir kun ko'rinmaydi (Task 4, `unfinishedMatchCachedForShortTtl`).
4. **Redis ishlamayapti**: API 500 bermasdan keshsiz rejimda FACEIT'dan javob qaytarishi kerak (Task 4, `redisFailureFallsThroughToDelegate`).
5. **Nickname o'zgargan o'yinchi** (bir xil `faceit_id`, yangi nickname): UNIQUE xatosi emas, mavjud qator yangilanadi (Task 5, `upsertUpdatesNicknameForExistingFaceitId`).

---

## Fayl tuzilmasi

```
.
├── docker-compose.yml                 # postgres, redis, backend, frontend
├── .env.example
├── .gitignore
├── backend/
│   ├── pom.xml
│   ├── Dockerfile
│   └── src/
│       ├── main/java/io/csfaceit/backend/
│       │   ├── BackendApplication.java
│       │   ├── common/api/            # ApiError, NotFoundException, ApiExceptionHandler
│       │   ├── config/                # AppProperties, SecurityConfig, ApiKeyAuthFilter
│       │   ├── faceit/                # FaceitGateway, HttpFaceitGateway, CachingFaceitGateway,
│       │   │   │                      # FaceitProperties, Faceit*Exception
│       │   │   └── dto/               # FACEIT JSON'iga mos record'lar
│       │   ├── player/                # Player, PlayerRepository, PlayerService, PlayerController
│       │   │   └── dto/               # PlayerResponse, MatchHistoryResponse, MatchSummary, MatchResult
│       │   └── match/                 # Match, PlayerMatchStats, *Repository, MatchService, MatchController
│       │       └── dto/               # MatchResponse, MatchStatsResponse va ichki record'lar
│       ├── main/resources/
│       │   ├── application.yml
│       │   └── db/migration/V1__init.sql
│       └── test/
│           ├── java/io/csfaceit/backend/
│           │   ├── AbstractIntegrationTest.java   # Testcontainers (PG, Redis) + WireMock
│           │   └── ... (har paket o'z testlari)
│           └── resources/faceit/*.json            # WireMock fixture'lari
└── frontend/
    ├── package.json, vite.config.ts, tsconfig.json, components.json
    ├── Dockerfile, nginx.conf
    ├── e2e/search-flow.spec.ts, playwright.config.ts
    └── src/
        ├── main.tsx, App.tsx
        ├── api/client.ts, api/types.ts, api/queries.ts
        ├── pages/SearchPage.tsx, PlayerPage.tsx, MatchPage.tsx
        └── components/PlayerHeader.tsx, MatchList.tsx, StatsTable.tsx
```

**Mas'uliyat chegaralari:** `faceit/` paketi FACEIT'ning JSON shaklini biladi, lekin bizning DB yoki API DTO'larimizni bilmaydi. `player/` va `match/` paketlari `FaceitGateway` interfeysi orqali ma'lumot oladi, ichki DTO'ga aylantiradi va DB'ga yozadi. Controller'lar faqat HTTP: validatsiya + servis chaqiruvi. Frontend `api/types.ts` backend DTO'larini aynan takrorlaydi.

---

### Task 1: Backend skeleti, Flyway V1 va test infratuzilmasi

**Files:**
- Create: `backend/pom.xml`
- Create: `backend/src/main/java/io/csfaceit/backend/BackendApplication.java`
- Create: `backend/src/main/resources/application.yml`
- Create: `backend/src/main/resources/db/migration/V1__init.sql`
- Create: `backend/src/test/java/io/csfaceit/backend/AbstractIntegrationTest.java`
- Create: `backend/src/test/java/io/csfaceit/backend/SchemaMigrationTest.java`
- Create: `docker-compose.yml`, `.env.example`, `.gitignore`

**Interfaces:**
- Produces: `AbstractIntegrationTest` — `@SpringBootTest @AutoConfigureMockMvc` abstrakt sinf, **singleton konteyner** uslubida: `static final PostgreSQLContainer<?> postgres` (`postgres:17`), `static final GenericContainer<?> redis` (`redis:8`, port 6379) va `protected static final WireMockServer faceit` (`options().dynamicPort()`) `static {}` blokida bir marta ishga tushiriladi (`@Testcontainers`/`@Container`/`WireMockExtension` ishlatilmaydi — ular har test sinfida qayta ishga tushib, keshlangan Spring kontekstini eskirgan portlarda qoldiradi). `@DynamicPropertySource` orqali `spring.datasource.*`, `spring.data.redis.host/port`, `faceit.base-url=<wiremock baseUrl>`, `faceit.api-key=test-key`, `app.security.api-key=test-admin-key` o'rnatiladi. `@BeforeEach void resetState()`: `faceit.resetAll()`; `TRUNCATE player_match_stats, highlights, matches, players RESTART IDENTITY CASCADE` (`JdbcTemplate`); Redis `FLUSHALL` — `@Autowired RedisConnectionFactory` orqali (template orqali emas: keyingi testlar `StringRedisTemplate`ni mock qiladi). Yordamchilar: `@Autowired protected MockMvc mvc`, `protected static String fixture(String classpathPath)` (classpath resursini UTF-8 matn sifatida o'qiydi). Keyingi barcha integratsion testlar shundan meros oladi.
- Produces: `V1__init.sql` jadvallari (Task 2 entity'lari shunga mos bo'ladi).

- [ ] **Step 1: `pom.xml` yozish**

Parent `spring-boot-starter-parent` (Maven Central'dagi eng so'nggi 3.5.x), `java.version=21`. Dependency'lar: `spring-boot-starter-web`, `-data-jpa`, `-data-redis`, `-validation`, `-actuator`, `spring-retry`, `spring-aspects`, `flyway-core`, `flyway-database-postgresql`, `postgresql` (runtime), `micrometer-registry-prometheus`, `spring-boot-configuration-processor` (optional). Test: `spring-boot-starter-test`, `spring-boot-testcontainers`, `org.testcontainers:postgresql`, `org.testcontainers:junit-jupiter`, `org.wiremock:wiremock-standalone:3.x` (shaded variant — Spring Boot boshqaradigan Jetty 12 bilan to'qnashmaydi). `spring-boot-starter-security` bu vazifada **qo'shilmaydi** — Task 7 da qo'shiladi (aks holda Task 5–6 GET testlari 401 oladi). Maven wrapper: `cd backend && mvn -N wrapper:wrapper` (`mvnw`, `mvnw.cmd`, `.mvn/` commit qilinadi).

- [ ] **Step 2: `BackendApplication` va `application.yml`**

`@SpringBootApplication @EnableRetry @ConfigurationPropertiesScan`. `application.yml` qiymatlari (muhit o'zgaruvchisi, default):

```yaml
spring:
  datasource:
    url: ${DB_URL:jdbc:postgresql://localhost:5432/csfaceit}
    username: ${DB_USER:csfaceit}
    password: ${DB_PASSWORD:csfaceit}
  jpa:
    hibernate.ddl-auto: validate
    open-in-view: false
  data.redis:
    host: ${REDIS_HOST:localhost}
    port: ${REDIS_PORT:6379}
faceit:
  base-url: ${FACEIT_BASE_URL:https://open.faceit.com/data/v4}
  api-key: ${FACEIT_API_KEY}
  connect-timeout: 5s
  read-timeout: 10s
  retry: { max-attempts: 3, initial-backoff: 200ms, multiplier: 2.0 }
  cache: { player-ttl: 5m, history-ttl: 2m, match-ttl: 24h, unfinished-match-ttl: 30s, stale-ttl: 7d }
app:
  security.api-key: ${APP_API_KEY}
  cors.allowed-origins: ${CORS_ALLOWED_ORIGINS:http://localhost:5173}
management:
  endpoints.web.exposure.include: health,info,metrics,prometheus
```

- [ ] **Step 3: `V1__init.sql` yozish**

Spec 11-bo'limdagi 4 asosiy jadval, aynan shu ustunlar:

```sql
CREATE TABLE players (
  id BIGSERIAL PRIMARY KEY,
  faceit_id VARCHAR(64) NOT NULL UNIQUE,
  nickname  VARCHAR(64) NOT NULL,
  elo INTEGER, level INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE matches (
  id BIGSERIAL PRIMARY KEY,
  faceit_match_id VARCHAR(64) NOT NULL UNIQUE,
  map_name VARCHAR(64), started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ);
CREATE TABLE player_match_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id),
  match_id  BIGINT NOT NULL REFERENCES matches(id),
  kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0, headshots INTEGER NOT NULL DEFAULT 0,
  adr NUMERIC(6,2), kast NUMERIC(5,2), rating NUMERIC(5,2),
  UNIQUE (player_id, match_id));
CREATE TABLE highlights (
  id BIGSERIAL PRIMARY KEY,
  match_id  BIGINT NOT NULL REFERENCES matches(id),
  player_id BIGINT NOT NULL REFERENCES players(id),
  type VARCHAR(32) NOT NULL, round_number INTEGER NOT NULL,
  tick_start INTEGER NOT NULL, tick_end INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_highlights_player_type ON highlights (player_id, type);
CREATE INDEX idx_pms_player ON player_match_stats (player_id);
```

- [ ] **Step 4: `AbstractIntegrationTest` va muvaffaqiyatsiz test yozish**

```java
class SchemaMigrationTest extends AbstractIntegrationTest {
  @Autowired JdbcTemplate jdbc;
  @Test void flywayCreatesFourBaseTables() {
    List<String> tables = jdbc.queryForList(
      "select table_name from information_schema.tables where table_schema='public' order by 1", String.class);
    assertThat(tables).contains("players", "matches", "player_match_stats", "highlights", "flyway_schema_history");
  }
}
```

- [ ] **Step 5: Testni ishga tushirish, o'tishini tekshirish**

Run: `cd backend && ./mvnw -q test -Dtest=SchemaMigrationTest` (Docker ishlab turishi kerak)
Expected: `Tests run: 1, Failures: 0`

- [ ] **Step 6: `docker-compose.yml`, `.env.example`, `.gitignore`**

Compose servislari: `postgres` (`postgres:17`, `POSTGRES_DB: csfaceit`, `POSTGRES_USER: ${DB_USER:-csfaceit}`, `POSTGRES_PASSWORD: ${DB_PASSWORD:-csfaceit}` — `.env` bo'lmasa ham ishlaydi; volume `pgdata`, port 5432, `pg_isready` healthcheck), `redis` (`redis:8`, port 6379, `redis-cli ping` healthcheck). `backend`/`frontend` servislari Task 12 da qo'shiladi. `.env.example` kalitlari: `DB_URL, DB_USER, DB_PASSWORD, REDIS_HOST, REDIS_PORT, FACEIT_API_KEY, APP_API_KEY, CORS_ALLOWED_ORIGINS, WEB_PORT` — sirlar bo'sh, qolganlari dev default qiymatlari bilan. `.gitignore`: `.env`, `backend/target/`, `frontend/node_modules/`, `frontend/dist/`, `frontend/test-results/`, `frontend/playwright-report/`.

Run: `docker compose config -q && docker compose up -d --wait postgres redis && docker compose ps && docker compose down`
Expected: ikkala servis `running (healthy)`; tekshiruvdan so'ng `down` bilan to'xtatiladi (volume saqlanadi).

- [ ] **Step 7: Commit**

```bash
git add backend docker-compose.yml .env.example .gitignore
git commit -m "feat(backend): bootstrap Spring Boot app with Flyway V1 schema and test containers"
```

---

### Task 2: Entity'lar va repository'lar

**Files:**
- Create: `backend/src/main/java/io/csfaceit/backend/player/Player.java`, `PlayerRepository.java`
- Create: `backend/src/main/java/io/csfaceit/backend/match/Match.java`, `MatchRepository.java`, `PlayerMatchStats.java`, `PlayerMatchStatsRepository.java`
- Test: `backend/src/test/java/io/csfaceit/backend/player/PlayerRepositoryTest.java`, `.../match/PlayerMatchStatsRepositoryTest.java`

**Interfaces:**
- Produces: `Player { Long id; String faceitId; String nickname; Integer elo; Integer level; Instant createdAt; Instant updatedAt }` (`@PrePersist/@PreUpdate` vaqtni o'rnatadi). `PlayerRepository extends JpaRepository<Player, Long>` + `Optional<Player> findByFaceitId(String faceitId)`.
- Produces: `Match { Long id; String faceitMatchId; String mapName; Instant startedAt; Instant finishedAt }`, `MatchRepository` + `Optional<Match> findByFaceitMatchId(String)`.
- Produces: `PlayerMatchStats { Long id; Player player; Match match; int kills, deaths, assists, headshots; BigDecimal adr, kast, rating }`, `PlayerMatchStatsRepository` + `Optional<PlayerMatchStats> findByPlayerIdAndMatchId(Long playerId, Long matchId)`.

- [ ] **Step 1: Muvaffaqiyatsiz testlarni yozish**

```java
class PlayerRepositoryTest extends AbstractIntegrationTest {
  @Autowired PlayerRepository players;
  @Test void savesAndFindsByFaceitId() {
    players.save(new Player("f-1", "s1mple", 3500, 10));
    assertThat(players.findByFaceitId("f-1")).get()
      .extracting(Player::getNickname, Player::getElo, Player::getLevel).containsExactly("s1mple", 3500, 10);
    assertThat(players.findByFaceitId("f-1").get().getCreatedAt()).isNotNull();
  }
}
class PlayerMatchStatsRepositoryTest extends AbstractIntegrationTest {
  @Test void uniqueOnPlayerAndMatch() { /* ikkinchi save -> DataIntegrityViolationException */ }
  @Test void findByPlayerIdAndMatchIdReturnsRow() { /* saqlangan qatorni topadi */ }
}
```

- [ ] **Step 2: Testlar kompilyatsiya xatosi bilan tushishini tekshirish**

Run: `./mvnw -q test -Dtest='PlayerRepositoryTest,PlayerMatchStatsRepositoryTest'`
Expected: COMPILATION ERROR (`Player` topilmadi).

- [ ] **Step 3: Entity va repository'larni yozish**

Jadval/ustun nomlari `V1__init.sql` ga aynan mos (`@Table(name="players")`, `@Column(name="faceit_id")` ...). `Player(String faceitId, String nickname, Integer elo, Integer level)` konstruktori; `Match(String faceitMatchId, String mapName, Instant startedAt, Instant finishedAt)`; `PlayerMatchStats(Player, Match)` + setter'lar. `ddl-auto=validate` kontekst ko'tarilganda sxema mosligini tekshiradi.

- [ ] **Step 4: Testlar o'tishini tekshirish**

Run: `./mvnw -q test -Dtest='PlayerRepositoryTest,PlayerMatchStatsRepositoryTest'`
Expected: `Tests run: 3, Failures: 0`

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(backend): add Player, Match, PlayerMatchStats entities and repositories"
```

---

### Task 3: FACEIT HTTP klienti (`HttpFaceitGateway`)

**Files:**
- Create: `backend/src/main/java/io/csfaceit/backend/faceit/FaceitGateway.java`, `HttpFaceitGateway.java`, `FaceitProperties.java`, `FaceitNotFoundException.java`, `FaceitUnavailableException.java`, `FaceitClientConfig.java`
- Create: `backend/src/main/java/io/csfaceit/backend/faceit/dto/` — `FaceitPlayer`, `FaceitGame`, `FaceitMatchHistory`, `FaceitHistoryItem`, `FaceitHistoryTeam`, `FaceitHistoryPlayer`, `FaceitResults`, `FaceitMatch`, `FaceitMatchTeam`, `FaceitRosterPlayer`, `FaceitVoting`, `FaceitVotingMap`, `FaceitMatchStats`, `FaceitStatsRound`, `FaceitStatsTeam`, `FaceitStatsPlayer`
- Create: `backend/src/test/resources/faceit/` — `player.json`, `player-no-cs2.json`, `history.json`, `match-finished.json`, `match-ongoing.json`, `match-stats.json`
- Test: `backend/src/test/java/io/csfaceit/backend/faceit/HttpFaceitGatewayTest.java`

**Interfaces:**
- Produces:
  ```java
  public interface FaceitGateway {
    FaceitPlayer findPlayerByNickname(String nickname);      // GET /players?nickname=
    FaceitPlayer getPlayer(String playerId);                 // GET /players/{id}
    FaceitMatchHistory getHistory(String playerId, int offset, int limit); // GET /players/{id}/history?game=cs2&offset=&limit=
    FaceitMatch getMatch(String matchId);                    // GET /matches/{id}
    FaceitMatchStats getMatchStats(String matchId);          // GET /matches/{id}/stats
  }
  ```
  Barcha metodlar 404 da `FaceitNotFoundException`, 429/5xx/ulanish xatosida urinishlar tugagach `FaceitUnavailableException` tashlaydi. 401/403 (noto'g'ri yoki ruxsatsiz API kalit) ham `FaceitUnavailableException` (`ERROR` log: `FACEIT rejected the API key`) — foydalanuvchi 500 emas, 502 ko'radi.
- Produces (DTO'lar, barchasi `record`, `@JsonNaming(SnakeCaseStrategy)`, `@JsonIgnoreProperties(ignoreUnknown=true)`):
  - `FaceitPlayer(String playerId, String nickname, String avatar, String country, Map<String, FaceitGame> games)`; `FaceitGame(Integer faceitElo, Integer skillLevel)`. Yordamchi: `Optional<FaceitGame> cs2()` → `games.get("cs2")`.
  - `FaceitMatchHistory(List<FaceitHistoryItem> items, int start, int end)`; `FaceitHistoryItem(String matchId, long startedAt, long finishedAt, Map<String, FaceitHistoryTeam> teams, FaceitResults results)`; `FaceitHistoryTeam(String teamId, String nickname, List<FaceitHistoryPlayer> players)`; `FaceitHistoryPlayer(String playerId, String nickname)`; `FaceitResults(String winner, Map<String, Integer> score)`.
  - `FaceitMatch(String matchId, String status, Long startedAt, Long finishedAt, Map<String, FaceitMatchTeam> teams, FaceitVoting voting, FaceitResults results, List<String> demoUrl)`; `FaceitMatchTeam(String factionId, String name, List<FaceitRosterPlayer> roster)`; `FaceitRosterPlayer(String playerId, String nickname)`; `FaceitVoting(FaceitVotingMap map)`; `FaceitVotingMap(List<String> pick)`.
  - `FaceitMatchStats(List<FaceitStatsRound> rounds)`; `FaceitStatsRound(Map<String,String> roundStats, List<FaceitStatsTeam> teams)`; `FaceitStatsTeam(String teamId, Map<String,String> teamStats, List<FaceitStatsPlayer> players)`; `FaceitStatsPlayer(String playerId, String nickname, Map<String,String> playerStats)`.
- Produces: `FaceitProperties(String baseUrl, String apiKey, Duration connectTimeout, Duration readTimeout, Retry retry, Cache cache)`; `Retry(int maxAttempts, Duration initialBackoff, double multiplier)`; `Cache(Duration playerTtl, Duration historyTtl, Duration matchTtl, Duration unfinishedMatchTtl, Duration staleTtl)`.

Fixture qiymatlari (testlar shularga asoslanadi): player_id `11111111-1111-1111-1111-111111111111`, nickname `s1mple`, `games.cs2.faceit_elo=3500`, `skill_level=10`; `player-no-cs2.json` da `games` faqat `csgo`. Match id `1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, `match-finished.json`: `status="FINISHED"`, `voting.map.pick=["de_mirage"]`, `results.winner="faction1"`, `results.score={faction1:13, faction2:9}`, `demo_url=["https://demos.example/1.dem.gz"]`; `match-ongoing.json`: `status="ONGOING"`. `match-stats.json`: `rounds[0].round_stats={Map:"de_mirage", Rounds:"22", Score:"13 / 9"}`, `teams[0].team_stats={Team:"team_A","Team Win":"1","Final Score":"13"}`, o'yinchi `s1mple` uchun `player_stats={Kills:"25", Deaths:"14", Assists:"3", Headshots:"12", "K/D Ratio":"1.79", "K/R Ratio":"1.14", ADR:"95.4"}`.

Fixture shakli (Task 5–6 testlari shunga tayanadi): `match-finished.json` va `match-ongoing.json` da `teams.faction1` (`name="team_A"`) va `teams.faction2` (`name="team_B"`), har birida 5 tadan `roster` (jami 10 o'yinchi), `s1mple` `faction1` da. `match-stats.json` da 2 jamoa × 5 o'yinchi = 10 ta `players`; `teams[0]` = `team_A` (`Team Win="1"`, `Final Score="13"`), `teams[1]` = `team_B` (`Team Win="0"`, `Final Score="9"`); o'yinchi `player_id`lari roster bilan bir xil. `history.json`: `items` 2 ta, `start=0, end=2`; `items[0].match_id` — yuqoridagi match id, `s1mple` `teams.faction1.players` ichida, `results.winner="faction1"`, `results.score={faction1:13, faction2:9}`; `items[1]` da `s1mple` `faction2` da va `winner="faction1"` (LOSS holati).

- [ ] **Step 1: Muvaffaqiyatsiz testlarni yozish (WireMock)**

```java
class HttpFaceitGatewayTest extends AbstractIntegrationTest {
  @Autowired HttpFaceitGateway gateway;
  @Test void findsPlayerByNicknameWithBearerHeader() {
    faceit.stubFor(get(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo("s1mple"))
      .withHeader("Authorization", equalTo("Bearer test-key")).willReturn(okJson(fixture("faceit/player.json"))));
    FaceitPlayer p = gateway.findPlayerByNickname("s1mple");
    assertThat(p.playerId()).isEqualTo("11111111-1111-1111-1111-111111111111");
    assertThat(p.cs2()).get().extracting(FaceitGame::faceitElo, FaceitGame::skillLevel).containsExactly(3500, 10);
  }
  @Test void playerWithoutCs2HasNullEloAndLevel() { /* player-no-cs2.json -> p.cs2() isEmpty */ }
  @Test void notFoundMapsToFaceitNotFoundException() { /* 404 -> FaceitNotFoundException */ }
  @Test void unauthorizedMapsToFaceitUnavailable() { /* 401 -> FaceitUnavailableException */ }
  @Test void retriesOn5xxThenSucceeds() {
    // WireMock scenario: 1-urinish 503, 2-urinish 429, 3-urinish 200 -> natija qaytadi; verify 3 so'rov
  }
  @Test void givesUpAfterThreeAttempts() { /* 3x 503 -> FaceitUnavailableException; verify(3, ...) */ }
  @Test void historyPassesGameOffsetLimit() { /* ?game=cs2&offset=20&limit=10 so'ralganini verify */ }
  @Test void parsesMatchAndStats() { /* status, map pick, demoUrl, player_stats["Kills"]=="25" */ }
}
```

- [ ] **Step 2: Kompilyatsiya xatosi bilan tushishini tekshirish**

Run: `./mvnw -q test -Dtest=HttpFaceitGatewayTest`
Expected: COMPILATION ERROR.

- [ ] **Step 3: DTO'lar, `FaceitProperties`, `FaceitClientConfig`, `HttpFaceitGateway` ni yozish**

`FaceitClientConfig` `RestClient faceitRestClient(FaceitProperties)` bean'ini beradi: `baseUrl`, `defaultHeader("Authorization", "Bearer " + apiKey)`, `JdkClientHttpRequestFactory` bilan connect/read timeout; JDK `HttpClient` `HTTP_1_1` ga majburlanadi (WireMock bilan h2c upgrade muammosini oldini oladi). `RetryTemplate faceitRetryTemplate(FaceitProperties)`: `ExponentialBackOffPolicy(initialInterval=200ms, multiplier=2.0)`, `SimpleRetryPolicy(maxAttempts=3, retryableExceptions={FaceitUnavailableException, ResourceAccessException})`. `HttpFaceitGateway` har chaqiruvni `retryTemplate.execute(...)` ichida bajaradi; `onStatus(404 → FaceitNotFoundException)` (qayta urinilmaydi), `onStatus(401 || 403 || 429 || 5xx → FaceitUnavailableException)`. Har so'rov `MeterRegistry` da `Timer` `faceit.request` (tags: `resource` ∈ {player, player_search, history, match, match_stats}; `outcome` ∈ {success, not_found, error}) bilan o'lchanadi.

- [ ] **Step 4: Testlar o'tishini tekshirish**

Run: `./mvnw -q test -Dtest=HttpFaceitGatewayTest`
Expected: `Tests run: 8, Failures: 0`

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(faceit): add FACEIT Data API v4 gateway with retry, timeouts and metrics"
```

---

### Task 4: Redis kesh dekoratori (`CachingFaceitGateway`)

**Files:**
- Create: `backend/src/main/java/io/csfaceit/backend/faceit/CachingFaceitGateway.java`
- Modify: `backend/src/main/java/io/csfaceit/backend/faceit/FaceitClientConfig.java` (bean'lar: `HttpFaceitGateway` → `@Qualifier("httpFaceitGateway")`, `CachingFaceitGateway` → `@Primary FaceitGateway`)
- Test: `backend/src/test/java/io/csfaceit/backend/faceit/CachingFaceitGatewayTest.java`

**Interfaces:**
- Consumes: `FaceitGateway` (Task 3), `FaceitProperties.Cache`.
- Produces: `CachingFaceitGateway implements FaceitGateway` — konstruktor `(FaceitGateway delegate, StringRedisTemplate redis, ObjectMapper mapper, FaceitProperties props)`. Bu `@Primary` bean; servislar faqat `FaceitGateway` tipini inject qiladi. `FaceitClientConfig` da u `@Qualifier("httpFaceitGateway") FaceitGateway delegate` bilan yig'iladi (konkret `HttpFaceitGateway` tipi bilan emas — testlar shu nomdagi bean'ni mock bilan almashtiradi).

Kesh qoidalari (bu plan qarori, spec 5-bo'limdan):
- Kalitlar: `faceit:player:{playerId}`, `faceit:player-search:{nickname.toLowerCase()}`, `faceit:history:{playerId}:{offset}:{limit}`, `faceit:match:{matchId}`, `faceit:match-stats:{matchId}`. Eskirgan nusxa: `faceit:stale:<yuqoridagi kalit qismi>` (TTL `staleTtl`=7 kun).
- TTL: player va player-search 5 daq; history 2 daq; match va match-stats — `FaceitMatch.status == "FINISHED"` bo'lsa 24 soat, aks holda `unfinishedMatchTtl` (30 s). Match-stats uchun tugaganlik `match` kaliti orqali emas, stats javobi mavjudligi bilan belgilanadi: FACEIT tugamagan match uchun stats bermaydi, shuning uchun stats har doim 24 soat.
- Oqim: fresh kalitni o'qi → bor bo'lsa qaytar. Yo'q bo'lsa delegate'ni chaqir → fresh va stale kalitlarga yoz → qaytar. Delegate `FaceitUnavailableException` tashlasa → stale kalitni o'qi → bor bo'lsa qaytar, yo'q bo'lsa istisnoni qayta tashla. `FaceitNotFoundException` keshlanmaydi va stale'ga tushmaydi.
- Redis'ning har qanday `DataAccessException`'i `WARN` log bilan yutiladi; natija delegate'dan to'g'ridan-to'g'ri qaytadi.

- [ ] **Step 1: Muvaffaqiyatsiz testlarni yozish**

Delegate `@MockitoBean(name="httpFaceitGateway")` bilan almashtiriladi; Redis — Testcontainers (haqiqiy).

```java
class CachingFaceitGatewayTest extends AbstractIntegrationTest {
  @MockitoBean(name = "httpFaceitGateway") FaceitGateway delegate;
  @Autowired FaceitGateway gateway; @Autowired StringRedisTemplate redis;
  @BeforeEach void flush() { redis.getConnectionFactory().getConnection().serverCommands().flushAll(); }
  @Test void secondCallServedFromCacheWithFiveMinuteTtl() {
    when(delegate.getPlayer("p1")).thenReturn(player("p1"));
    gateway.getPlayer("p1"); gateway.getPlayer("p1");
    verify(delegate, times(1)).getPlayer("p1");
    assertThat(redis.getExpire("faceit:player:p1", TimeUnit.SECONDS)).isBetween(290L, 300L);
  }
  @Test void historyTtlIsTwoMinutes() { /* faceit:history:p1:0:20 -> 110..120 s */ }
  @Test void finishedMatchCachedFor24Hours() { /* faceit:match:m1 -> 86000..86400 s */ }
  @Test void unfinishedMatchCachedForShortTtl() { /* status ONGOING -> <= 30 s */ }
  @Test void staleReturnedWhenDelegateUnavailable() {
    when(delegate.getPlayer("p1")).thenReturn(player("p1")).thenThrow(new FaceitUnavailableException("503"));
    gateway.getPlayer("p1"); redis.delete("faceit:player:p1");
    assertThat(gateway.getPlayer("p1").nickname()).isEqualTo("s1mple");
  }
  @Test void unavailableWithoutStaleRethrows() { /* stale yo'q -> FaceitUnavailableException */ }
  @Test void notFoundIsNotCached() { /* 2 chaqiruv -> delegate 2 marta, kalit yo'q */ }
}
class CachingFaceitGatewayRedisDownTest extends AbstractIntegrationTest { // @MockitoBean tufayli alohida kontekst
  @MockitoBean StringRedisTemplate redis; @MockitoBean(name="httpFaceitGateway") FaceitGateway delegate;
  @Test void redisFailureFallsThroughToDelegate() {
    when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("down"));
    when(delegate.getPlayer("p1")).thenReturn(player("p1"));
    assertThat(gateway.getPlayer("p1").nickname()).isEqualTo("s1mple");
  }
}
```

- [ ] **Step 2: Tushishini tekshirish**

Run: `./mvnw -q test -Dtest='CachingFaceitGateway*'`
Expected: COMPILATION ERROR (`CachingFaceitGateway` yo'q).

- [ ] **Step 3: `CachingFaceitGateway` ni yozish va bean'larni ulash**

Umumiy yordamchi: `private <T> T cached(String key, Duration ttl, Class<T> type, Supplier<T> loader)` — yuqoridagi oqim; TTL'ni match uchun natijaga qarab tanlash uchun `Function<T, Duration> ttlFn` varianti. JSON serializatsiya `ObjectMapper` bilan (Jackson `JavaTimeModule` kerak emas — DTO'larda `Instant` yo'q).

- [ ] **Step 4: Testlar o'tishini tekshirish**

Run: `./mvnw -q test -Dtest='CachingFaceitGateway*'`
Expected: `Tests run: 8, Failures: 0`

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(faceit): add Redis caching decorator with per-resource TTL and stale fallback"
```

---

### Task 5: Player API (`/api/v1/players`)

**Files:**
- Create: `backend/src/main/java/io/csfaceit/backend/common/api/ApiError.java`, `NotFoundException.java`, `ApiExceptionHandler.java`
- Create: `backend/src/main/java/io/csfaceit/backend/player/PlayerService.java`, `PlayerController.java`
- Create: `backend/src/main/java/io/csfaceit/backend/player/dto/PlayerResponse.java`, `MatchHistoryResponse.java`, `MatchSummary.java`, `MatchResult.java`
- Test: `backend/src/test/java/io/csfaceit/backend/player/PlayerControllerTest.java`, `PlayerServiceTest.java`

**Interfaces:**
- Consumes: `FaceitGateway` (Task 3/4), `PlayerRepository` (Task 2).
- Produces:
  - `record ApiError(String code, String message)`; `class NotFoundException extends RuntimeException { String code; }`.
  - `ApiExceptionHandler` (`@RestControllerAdvice`): `NotFoundException` → 404 `ApiError(code, message)`; `FaceitNotFoundException` → 404 (kod kontekstga qarab controller/servis tomonidan `NotFoundException`ga o'raladi); `FaceitUnavailableException` → 502 `FACEIT_UNAVAILABLE`; `MethodArgumentNotValidException`/`ConstraintViolationException`/`HandlerMethodValidationException` → 400 `VALIDATION_ERROR`; Spring MVC'ning standart istisnolari o'z HTTP statusini saqlaydi (masalan `ResponseEntityExceptionHandler`dan meros olib): yo'q/noto'g'ri tipli parametr → 400 `VALIDATION_ERROR`, xaritalanmagan yo'l (`NoResourceFoundException`) → 404 `NOT_FOUND`, noto'g'ri metod → 405 `METHOD_NOT_ALLOWED`; qolgan hamma narsa → 500 `INTERNAL_ERROR` (stack trace `ERROR` log'da, javobda ichki tafsilot yo'q).
  - `record PlayerResponse(String playerId, String nickname, String avatar, String country, Integer elo, Integer level)`.
  - `enum MatchResult { WIN, LOSS, UNKNOWN }`; `record MatchSummary(String matchId, Instant startedAt, Instant finishedAt, MatchResult result, Map<String,Integer> score)`; `record MatchHistoryResponse(List<MatchSummary> items, int offset, int limit)`.
  - `PlayerService`: `PlayerResponse findByNickname(String nickname)`, `PlayerResponse getById(String playerId)`, `MatchHistoryResponse getHistory(String playerId, int offset, int limit)`, `Player upsert(FaceitPlayer p)` (faceit_id bo'yicha topadi yoki yaratadi; nickname/elo/level yangilaydi).
  - HTTP: `GET /api/v1/players?nickname=` (`@Pattern(regexp="^[A-Za-z0-9_-]{2,32}$")`), `GET /api/v1/players/{playerId}`, `GET /api/v1/players/{playerId}/history?offset=0&limit=20` (`offset ≥ 0`, `1 ≤ limit ≤ 100`).
  - `MatchResult` hisoblash: history item'da `playerId` qaysi `teams.{factionN}.players[]` ichida bo'lsa, `results.winner == factionN` → WIN, boshqasi → LOSS, topilmasa → UNKNOWN.

- [ ] **Step 1: Muvaffaqiyatsiz testlarni yozish**

```java
class PlayerControllerTest extends AbstractIntegrationTest {   // MockMvc + WireMock
  @Test void searchByNicknameReturnsProfileAndPersistsPlayer() {
    stubPlayerSearch("s1mple", "faceit/player.json");
    mvc.perform(get("/api/v1/players").param("nickname", "s1mple"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.playerId").value("11111111-1111-1111-1111-111111111111"))
      .andExpect(jsonPath("$.elo").value(3500)).andExpect(jsonPath("$.level").value(10));
    assertThat(players.findByFaceitId("11111111-1111-1111-1111-111111111111")).isPresent();
  }
  @Test void unknownNicknameReturns404PlayerNotFound() { /* 404 + $.code == "PLAYER_NOT_FOUND" */ }
  @Test void invalidNicknameReturns400() { /* "a", 33 ta 'x', "<script>" -> 400, $.code == "VALIDATION_ERROR" */ }
  @Test void missingNicknameReturns400() { /* GET /api/v1/players (parametrsiz) -> 400, $.code == "VALIDATION_ERROR" */ }
  @Test void unknownRouteReturns404NotFound() { /* GET /api/v1/nope -> 404, $.code == "NOT_FOUND" (500 emas) */ }
  @Test void getByIdReturnsProfile() { /* /players/{id} -> 200 */ }
  @Test void historyMapsWinLossForPlayer() {
    // history.json: s1mple faction1 da, winner=faction1 -> items[0].result == "WIN"; score.faction1 == 13
  }
  @Test void historyRejectsLimitAbove100AndNegativeOffset() { /* limit=101 -> 400; offset=-1 -> 400 */ }
  @Test void faceitOutageReturns502() { /* 3x 503 -> 502, $.code == "FACEIT_UNAVAILABLE" */ }
}
class PlayerServiceTest extends AbstractIntegrationTest {
  @Test void upsertUpdatesNicknameForExistingFaceitId() {
    service.upsert(faceitPlayer("f-1", "oldNick", 2000, 7));
    service.upsert(faceitPlayer("f-1", "newNick", 2100, 8));
    assertThat(players.count()).isEqualTo(1);
    assertThat(players.findByFaceitId("f-1")).get().extracting(Player::getNickname, Player::getElo).containsExactly("newNick", 2100);
  }
}
```

- [ ] **Step 2: Tushishini tekshirish** — Run: `./mvnw -q test -Dtest='Player*Test'`; Expected: COMPILATION ERROR.

- [ ] **Step 3: DTO, `ApiExceptionHandler`, `PlayerService`, `PlayerController` ni yozish**

Controller `@Validated`; `nickname` `@RequestParam @Pattern(...)`. Servis `FaceitNotFoundException`ni ushlab `new NotFoundException("PLAYER_NOT_FOUND", "Player not found: " + nickname)` tashlaydi. `startedAt`/`finishedAt` epoch soniyadan `Instant.ofEpochSecond`.

- [ ] **Step 4: O'tishini tekshirish** — Run: `./mvnw -q test -Dtest='Player*Test'`; Expected: `Tests run: 10, Failures: 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(player): add player search, profile and history endpoints with validation and error mapping"
```

---

### Task 6: Match API (`/api/v1/matches`)

**Files:**
- Create: `backend/src/main/java/io/csfaceit/backend/match/MatchService.java`, `MatchController.java`
- Create: `backend/src/main/java/io/csfaceit/backend/match/dto/MatchResponse.java`, `TeamResponse.java`, `RosterPlayerResponse.java`, `MatchStatsResponse.java`, `TeamStatsResponse.java`, `PlayerStatsResponse.java`
- Modify: `backend/src/main/java/io/csfaceit/backend/player/PlayerService.java` (`ensurePlayer`)
- Test: `backend/src/test/java/io/csfaceit/backend/match/MatchControllerTest.java`

**Interfaces:**
- Consumes: `FaceitGateway`, `MatchRepository`, `PlayerRepository`, `PlayerMatchStatsRepository`, `PlayerService` (Task 5). Bu vazifa `PlayerService` ga `Player ensurePlayer(String faceitId, String nickname)` qo'shadi: `faceit_id` bo'yicha topadi yoki `elo=null, level=null` bilan yaratadi; mavjud qatorning elo/level qiymatiga tegmaydi (nickname o'zgargan bo'lsa yangilaydi). `upsert(FaceitPlayer)` bu yerda ishlatilmaydi — u elo/level ni ustidan yozadi.
- Produces:
  - `record MatchResponse(String matchId, String mapName, String status, Instant startedAt, Instant finishedAt, String demoUrl, List<TeamResponse> teams, String winner)`; `TeamResponse(String factionId, String name, List<RosterPlayerResponse> players)`; `RosterPlayerResponse(String playerId, String nickname)`. `mapName` = `voting.map.pick[0]` (yo'q bo'lsa null); `demoUrl` = `demo_url[0]` (yo'q bo'lsa null).
  - `record MatchStatsResponse(String matchId, String mapName, int rounds, List<TeamStatsResponse> teams)`; `TeamStatsResponse(String teamId, String name, int score, boolean win, List<PlayerStatsResponse> players)`; `PlayerStatsResponse(String playerId, String nickname, int kills, int deaths, int assists, int headshots, double kdRatio, double krRatio, double adr)`. Manba kalitlari: `round_stats.Map/Rounds`, `team_stats.Team/"Team Win"/"Final Score"`, `player_stats.Kills/Deaths/Assists/Headshots/"K/D Ratio"/"K/R Ratio"/ADR`. Yo'q kalit → 0.
  - `MatchService`: `MatchResponse getMatch(String matchId)` (`matches` upsert: faceit_match_id, map_name, started_at, finished_at), `MatchStatsResponse getStats(String matchId)` (match yo'q bo'lsa avval `getMatch`; har o'yinchi uchun `players` upsert (elo/level null qoldiriladi, mavjud bo'lsa o'zgartirilmaydi) va `player_match_stats` upsert: kills, deaths, assists, headshots, adr; kast/rating null).
  - HTTP: `GET /api/v1/matches/{matchId}`, `GET /api/v1/matches/{matchId}/stats`. 404 kodi `MATCH_NOT_FOUND`.

- [ ] **Step 1: Muvaffaqiyatsiz testlarni yozish**

```java
class MatchControllerTest extends AbstractIntegrationTest {
  @Test void getMatchReturnsDetailsAndPersistsMatch() {
    // match-finished.json -> $.mapName == "de_mirage", $.winner == "faction1", $.demoUrl endsWith ".dem.gz"
    // matches.findByFaceitMatchId(...) isPresent, mapName == "de_mirage"
  }
  @Test void unknownMatchReturns404MatchNotFound() { }
  @Test void getStatsReturnsPerPlayerNumbersAndPersistsPlayerMatchStats() {
    // $.rounds == 22; team_A: score 13, win true; s1mple: kills 25, deaths 14, headshots 12, adr 95.4
    // player_match_stats: 10 qator, s1mple qatori kills=25
  }
  @Test void getStatsTwiceDoesNotDuplicateRows() { /* ikki chaqiruv -> player_match_stats.count() == 10 */ }
  @Test void getStatsKeepsExistingPlayerElo() { /* avval s1mple elo=3500 saqlangan -> getStats dan keyin ham 3500 */ }
}
```

- [ ] **Step 2: Tushishini tekshirish** — Run: `./mvnw -q test -Dtest=MatchControllerTest`; Expected: COMPILATION ERROR.

- [ ] **Step 3: DTO, `MatchService`, `MatchController` ni yozish**

Raqamli maydonlar `Integer.parseInt`/`Double.parseDouble` bilan; bo'sh/yo'q → 0. Upsert'lar `@Transactional`.

- [ ] **Step 4: O'tishini tekshirish** — Run: `./mvnw -q test -Dtest=MatchControllerTest`; Expected: `Tests run: 5, Failures: 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(match): add match details and stats endpoints with persistence"
```

---

### Task 7: Xavfsizlik (API kalit, CORS) va kuzatuvchanlik

**Files:**
- Create: `backend/src/main/java/io/csfaceit/backend/config/AppProperties.java`, `SecurityConfig.java`, `ApiKeyAuthFilter.java`
- Modify: `backend/pom.xml` (`spring-boot-starter-security`; test: `spring-security-test`)
- Test: `backend/src/test/java/io/csfaceit/backend/config/SecurityConfigTest.java`, `ObservabilityTest.java`

**Interfaces:**
- Produces: `AppProperties(Security security, Cors cors)`; `Security(String apiKey)`; `Cors(List<String> allowedOrigins)`.
- Produces: `SecurityConfig` — `SecurityFilterChain`: CSRF o'chirilgan, stateless; `permitAll`: `GET /api/v1/**`, `/actuator/health`, `/actuator/prometheus`, `OPTIONS /**`; qolgani `authenticated`. `ApiKeyAuthFilter extends OncePerRequestFilter`: `X-API-Key` sarlavhasi `app.security.api-key` ga teng bo'lsa `ROLE_ADMIN` bilan autentifikatsiya qo'yadi. Autentifikatsiya yo'q → `401` `ApiError("UNAUTHORIZED", ...)`. CORS: `allowedOrigins` dan, metodlar `GET, POST, OPTIONS`, sarlavhalar `Content-Type, X-API-Key`.
- Keyingi quyi loyihalar (`POST /api/v1/matches/{id}/demo/import`) shu filtrdan avtomatik himoyalanadi.

- [ ] **Step 1: Muvaffaqiyatsiz testlarni yozish**

```java
class SecurityConfigTest extends AbstractIntegrationTest {
  @Test void getEndpointsAreOpen() { /* GET /api/v1/players?nickname=s1mple (stub) -> 200 */ }
  @Test void postWithoutApiKeyIs401() { /* POST /api/v1/anything -> 401, $.code == "UNAUTHORIZED" */ }
  @Test void postWithWrongApiKeyIs401() { /* X-API-Key: wrong -> 401 */ }
  @Test void postWithApiKeyPassesFilter() { /* X-API-Key: test-admin-key -> 404 (handler yo'q), 401 emas */ }
  @Test void corsAllowsConfiguredOriginOnly() {
    // OPTIONS /api/v1/players, Origin: http://localhost:5173 -> Access-Control-Allow-Origin shu origin
    // Origin: http://evil.example -> sarlavha yo'q / 403
  }
}
class ObservabilityTest extends AbstractIntegrationTest {
  @Test void prometheusExposesFaceitRequestTimer() {
    // bitta /api/v1/players so'rovidan keyin GET /actuator/prometheus body contains "faceit_request_seconds_count"
  }
  @Test void healthIsUp() { /* /actuator/health -> $.status == "UP" */ }
}
```

- [ ] **Step 2: Tushishini tekshirish** — Run: `./mvnw -q test -Dtest='SecurityConfigTest,ObservabilityTest'`; Expected: FAIL (security hali yo'q: `postWithoutApiKeyIs401` 401 o'rniga 404 oladi).

- [ ] **Step 3: `pom.xml` ga security dependency'larini qo'shish; `AppProperties`, `ApiKeyAuthFilter`, `SecurityConfig` ni yozish**

`AuthenticationEntryPoint` 401 da `ApiError` JSON yozadi (`ObjectMapper`). `ObservabilityTest` `@AutoConfigureObservability(tracing = false)` bilan belgilanadi — `@SpringBootTest` sukut bo'yicha metrika eksportini (Prometheus registry) o'chiradi.

- [ ] **Step 4: O'tishini tekshirish** — Run: `./mvnw -q test`; Expected: barcha testlar o'tadi (`BUILD SUCCESS`).

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(security): protect non-read endpoints with X-API-Key, configure CORS and Prometheus metrics"
```

---

### Task 8: Frontend skeleti va API klienti

**Files:**
- Create: `frontend/` (Vite `react-ts` shabloni), `frontend/vite.config.ts`, `frontend/components.json`, `frontend/src/index.css`
- Create: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/api/queries.ts`
- Create: `frontend/src/App.tsx`, `frontend/src/main.tsx`
- Test: `frontend/src/api/client.test.ts`, `frontend/vitest.config.ts`, `frontend/src/test/setup.ts`

**Interfaces:**
- Produces: `api/types.ts` — backend DTO'larining aynan nusxasi: `PlayerResponse`, `MatchResult = 'WIN' | 'LOSS' | 'UNKNOWN'`, `MatchSummary`, `MatchHistoryResponse`, `MatchResponse`, `TeamResponse`, `RosterPlayerResponse`, `MatchStatsResponse`, `TeamStatsResponse`, `PlayerStatsResponse`, `ApiErrorBody = { code: string; message: string }`.
- Produces: `api/client.ts` — `class ApiError extends Error { status: number; code: string }`; `apiGet<T>(path: string, params?: Record<string, string | number>): Promise<T>` — `fetch(\`/api/v1${path}?...\`)`, `!res.ok` bo'lsa body'dan `ApiError(status, code, message)` tashlaydi (JSON bo'lmasa `code='UNKNOWN'`).
- Produces: `api/queries.ts` — TanStack Query hook'lari: `usePlayerSearch(nickname: string)` (`enabled: nickname.length >= 2`, key `['player-search', nickname]`), `usePlayer(playerId)`, `usePlayerHistory(playerId, offset = 0, limit = 20)`, `useMatch(matchId)`, `useMatchStats(matchId)`. `retry: false` 4xx uchun.
- Router (`App.tsx`): `/` → `SearchPage`, `/players/:playerId` → `PlayerPage`, `/matches/:matchId` → `MatchPage` (sahifalar Task 9–10 da; hozircha placeholder).
- Dev proxy (`vite.config.ts`): `/api` → `http://localhost:8080`.

- [ ] **Step 1: Loyihani yaratish**

```bash
cd frontend && npm create vite@latest . -- --template react-ts
npm i @tanstack/react-query react-router-dom
npm i -D tailwindcss @tailwindcss/vite vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
npx shadcn@latest init -d && npx shadcn@latest add button input card table skeleton badge
```

create-vite interaktiv savol bersa, interaktiv bo'lmagan flag'lardan foydalaning (yoki shablon fayllarini qo'lda yarating). `shadcn init` dan oldin `@/*` alias `tsconfig.json`, `tsconfig.app.json` va `vite.config.ts` da sozlangan, `src/index.css` da `@import "tailwindcss";` bo'lishi kerak.

- [ ] **Step 2: Muvaffaqiyatsiz testni yozish**

```ts
describe('apiGet', () => {
  it('builds /api/v1 URL with query params and returns JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ nickname: 's1mple' }))));
    await expect(apiGet('/players', { nickname: 's1mple' })).resolves.toEqual({ nickname: 's1mple' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/players?nickname=s1mple', expect.anything());
  });
  it('throws ApiError with code from body on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'PLAYER_NOT_FOUND', message: 'x' }), { status: 404 })));
    await expect(apiGet('/players', { nickname: 'nobody' })).rejects.toMatchObject({ status: 404, code: 'PLAYER_NOT_FOUND' });
  });
});
```

- [ ] **Step 3: Tushishini tekshirish** — Run: `npm test -- --run`; Expected: FAIL (`apiGet` eksport qilinmagan).

- [ ] **Step 4: `types.ts`, `client.ts`, `queries.ts`, `App.tsx` (QueryClientProvider + BrowserRouter) ni yozish**

- [ ] **Step 5: O'tishini tekshirish** — Run: `npm test -- --run && npm run build`; Expected: 2 passed, build xatosiz.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): bootstrap Vite React app with typed API client and query hooks"
```

---

### Task 9: Qidiruv va o'yinchi profili sahifalari

**Files:**
- Create: `frontend/src/pages/SearchPage.tsx`, `frontend/src/pages/PlayerPage.tsx`
- Create: `frontend/src/components/PlayerHeader.tsx`, `frontend/src/components/MatchList.tsx`
- Test: `frontend/src/pages/SearchPage.test.tsx`, `frontend/src/components/MatchList.test.tsx`

**Interfaces:**
- Consumes: `usePlayerSearch`, `usePlayer`, `usePlayerHistory` (Task 8).
- Produces: `SearchPage` — input (`placeholder="FACEIT nickname"`, `aria-label="nickname"`) + "Search" tugmasi; submit'da `usePlayerSearch` ishga tushadi; natija `PlayerHeader` ko'rinishida; `PLAYER_NOT_FOUND` da `Player not found` matni; muvaffaqiyatda `/players/{playerId}` ga o'tish havolasi. Natija kartasi `/players/{playerId}` ga olib boruvchi bitta `<Link>` ichida (accessible name nickname'ni o'z ichiga oladi).
- Produces: `PlayerHeader({ player: PlayerResponse })` — avatar, nickname, country, `ELO 3500`, `Level 10` badge.
- Produces: `MatchList({ items: MatchSummary[] })` — har qator: sana (`startedAt` lokal format), `WIN`/`LOSS` badge (yashil/qizil), score `13 : 9`, `/matches/{matchId}` havolasi. Bo'sh ro'yxat → `No matches yet`. Har qator **bitta** `<Link>` — butun qator mazmunini (sana, badge, score) o'rab turadi, shunda havolaning accessible name'i score'ni o'z ichiga oladi (Task 11 E2E: `getByRole('link', { name: /13 : 9/ })`).
- Produces: `PlayerPage` — `useParams().playerId`; `PlayerHeader` + `MatchList` (limit 20) + "Load more" tugmasi (`offset += 20`, natijalar birlashtiriladi); yuklanishda `Skeleton`.

- [ ] **Step 1: Muvaffaqiyatsiz testlarni yozish**

```tsx
it('shows player card after searching', async () => {
  mockFetchOnce({ playerId: 'p1', nickname: 's1mple', elo: 3500, level: 10, avatar: '', country: 'UA' });
  renderWithProviders(<SearchPage />);
  await userEvent.type(screen.getByLabelText('nickname'), 's1mple');
  await userEvent.click(screen.getByRole('button', { name: /search/i }));
  expect(await screen.findByText('s1mple')).toBeInTheDocument();
  expect(screen.getByText(/ELO 3500/)).toBeInTheDocument();
});
it('shows not-found message on 404', async () => { /* 404 PLAYER_NOT_FOUND -> "Player not found" */ });
it('MatchList renders WIN badge and score', () => {
  render(<MatchList items={[{ matchId: 'm1', startedAt: '2026-10-01T10:00:00Z', finishedAt: null, result: 'WIN', score: { faction1: 13, faction2: 9 } }]} />, { wrapper: MemoryRouter });
  expect(screen.getByText('WIN')).toBeInTheDocument();
  expect(screen.getByText('13 : 9')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/matches/m1');
});
```

`renderWithProviders` va `mockFetchOnce` yordamchilari `src/test/utils.tsx` da (QueryClient `retry: false`, `MemoryRouter`).

- [ ] **Step 2: Tushishini tekshirish** — Run: `npm test -- --run`; Expected: FAIL.
- [ ] **Step 3: Komponentlar va sahifalarni yozish** (shadcn `Card`, `Input`, `Button`, `Badge`, `Skeleton`).
- [ ] **Step 4: O'tishini tekshirish** — Run: `npm test -- --run`; Expected: barcha testlar passed.
- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add search and player profile pages with match history"
```

---

### Task 10: Match sahifasi

**Files:**
- Create: `frontend/src/pages/MatchPage.tsx`, `frontend/src/components/StatsTable.tsx`
- Test: `frontend/src/components/StatsTable.test.tsx`

**Interfaces:**
- Consumes: `useMatch`, `useMatchStats` (Task 8).
- Produces: `StatsTable({ team: TeamStatsResponse })` — jadval ustunlari aynan: `Player | K | D | A | HS | K/D | ADR`; sarlavhada jamoa nomi va score, g'olib jamoada `Winner` badge; o'yinchi nomi `/players/{playerId}` havolasi.
- Produces: `MatchPage` — `useParams().matchId`; sarlavha: `mapName`, sana, `status`; ikki `StatsTable`; `MATCH_NOT_FOUND` da `Match not found`.

- [ ] **Step 1: Muvaffaqiyatsiz test** — `renders header columns and player row`: `K/D` sarlavhasi bor; `s1mple` qatori `25`, `14`, `95.4` ni o'z ichiga oladi; `Winner` badge `win: true` bo'lganda ko'rinadi.
- [ ] **Step 2: Tushishini tekshirish** — Run: `npm test -- --run`; Expected: FAIL.
- [ ] **Step 3: `StatsTable`, `MatchPage` ni yozish** (shadcn `Table`).
- [ ] **Step 4: O'tishini tekshirish** — Run: `npm test -- --run && npm run build`; Expected: passed, build OK.
- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add match page with per-team stats tables"
```

---

### Task 11: E2E asosiy oqim (Playwright, mock API)

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/search-flow.spec.ts`
- Modify: `frontend/package.json` (`"e2e": "playwright test"`)

**Interfaces:**
- Consumes: Task 9–10 sahifalari. Backend talab qilinmaydi: `page.route('**/api/v1/**', ...)` fixture JSON qaytaradi (backend test fixture'lari bilan bir xil qiymatlar).

- [ ] **Step 1: Playwright o'rnatish** — `npm i -D @playwright/test && npx playwright install chromium`. Config: `webServer: { command: 'npm run dev', url: 'http://localhost:5173' }`.
- [ ] **Step 2: Testni yozish**

```ts
test('search -> profile -> match stats', async ({ page }) => {
  await page.route('**/api/v1/players?nickname=s1mple', r => r.fulfill({ json: playerFixture }));
  await page.route('**/api/v1/players/p1', r => r.fulfill({ json: playerFixture }));
  await page.route('**/api/v1/players/p1/history**', r => r.fulfill({ json: historyFixture }));
  await page.route('**/api/v1/matches/m1', r => r.fulfill({ json: matchFixture }));
  await page.route('**/api/v1/matches/m1/stats', r => r.fulfill({ json: statsFixture }));
  await page.goto('/');
  await page.getByLabel('nickname').fill('s1mple');
  await page.getByRole('button', { name: /search/i }).click();
  await page.getByRole('link', { name: /s1mple/ }).click();
  await expect(page.getByText('ELO 3500')).toBeVisible();
  await page.getByRole('link', { name: /13 : 9/ }).click();
  await expect(page.getByText('de_mirage')).toBeVisible();
  await expect(page.getByRole('cell', { name: '25' })).toBeVisible();
});
```

Playwright locator'lari strict rejimda: fixture'lar shunday tuzilsinki, `25` faqat bitta katakchada, `de_mirage` va `ELO 3500` sahifada bir martadan uchrasin.

- [ ] **Step 3: Ishga tushirish** — Run: `npm run e2e`; Expected: `1 passed`.
- [ ] **Step 4: Commit**

```bash
git add frontend/e2e frontend/playwright.config.ts frontend/package.json frontend/package-lock.json
git commit -m "test(frontend): add Playwright E2E for search-to-match flow"
```

---

### Task 12: Dockerfile'lar, Nginx va to'liq Compose

**Files:**
- Create: `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`
- Modify: `docker-compose.yml` (`backend`, `frontend` servislari)
- Create: `README.md` (ishga tushirish bo'limi)

**Interfaces:**
- `backend/Dockerfile`: ikki bosqich — `maven:3.9-eclipse-temurin-21` (`mvn -q -DskipTests package`) → `eclipse-temurin:21-jre`, `EXPOSE 8080`, `HEALTHCHECK` `/actuator/health`.
- `frontend/Dockerfile`: `node:22-alpine` (`npm ci && npm run build`) → `nginx:1.27-alpine`, `dist` → `/usr/share/nginx/html`, `nginx.conf` → `/etc/nginx/conf.d/default.conf`.
- `nginx.conf`: `location /api/ { proxy_pass http://backend:8080; }` (sarlavhalar `Host`, `X-Forwarded-For`), `location / { try_files $uri /index.html; }`.
- Compose: `backend` (`build: ./backend`, `env_file: .env`, `depends_on: postgres, redis` (healthy), port 8080 faqat ichki), `frontend` (`build: ./frontend`, `ports: "${WEB_PORT:-3000}:80"`, `depends_on: backend`). Compose ichida `DB_URL=jdbc:postgresql://postgres:5432/csfaceit`, `REDIS_HOST=redis`, `CORS_ALLOWED_ORIGINS=http://localhost:${WEB_PORT:-3000}` env orqali override qilinadi.

- [ ] **Step 1: Fayllarni yozish**
- [ ] **Step 2: Tekshirish**

Run: `cp .env.example .env` (qiymatlar to'ldiriladi; haqiqiy FACEIT kaliti bo'lmasa `FACEIT_API_KEY=dummy`), so'ng `docker compose up -d --build --wait`, `curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/` va `curl -s -w "\n%{http_code}\n" "localhost:3000/api/v1/players?nickname=s1mple"`; tekshiruvdan so'ng `docker compose down`.
Expected: `/` → `200`. API: haqiqiy kalit bilan `200` + JSON `playerId...`, ikkinchi so'rov 2 soniyadan kam (spec muvaffaqiyat mezoni 1); `dummy` kalit bilan `502` + `{"code":"FACEIT_UNAVAILABLE",...}` (Nginx → backend → FACEIT zanjiri ishlayotganini ko'rsatadi; jonli tekshiruv hisobotda "kutilmoqda" deb belgilanadi).

- [ ] **Step 3: README** — talablar (Docker, Java 21, Node 22), `.env` to'ldirish, `docker compose up`, dev rejim (`./mvnw spring-boot:run`, `npm run dev`), test buyruqlari.
- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile frontend/Dockerfile frontend/nginx.conf docker-compose.yml README.md
git commit -m "build: add Dockerfiles, Nginx proxy and full docker-compose stack"
```

---

## O'z-o'zini tekshirish (yozilgandan keyin)

- **Spec qamrovi:** 5-bo'lim endpointlari (Task 5, 6), kesh/TTL/kalit (Task 4), xatolar/retry/timeout (Task 3, 5), 11-bo'lim sxema va indekslar (Task 1, 2), 12-bo'lim xavfsizlik/CORS/validatsiya (Task 5, 7), 13-bo'lim metrikalar (Task 3, 7), 14-bo'lim testlar: WireMock (Task 3), Testcontainers (Task 1+), Vitest (Task 8–10), E2E (Task 11). Nginx/Compose (Task 12). Loki/OTel eksporti infratuzilma vazifasi — 2-quyi loyihada observability stack bilan birga (RabbitMQ metrikalari bilan birga ma'noli).
- **Nomlar:** `FaceitGateway` metodlari Task 3–6 da bir xil; `PlayerService.upsert` Task 5 da aniqlanib Task 6 da ishlatiladi; DTO maydon nomlari `types.ts` da takrorlanadi (Task 8).
- **Review Focus:** 5 ta holatning har biri test egasiga biriktirilgan (Task 3, 4, 5).
