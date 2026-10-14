package io.csfaceit.backend.cs2;

import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.auth.ForbiddenException;
import io.csfaceit.backend.auth.SignedInUser;
import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.cs2.Cs2Links.View;
import io.csfaceit.backend.cs2.SteamShareCodeClient.Answer;
import io.csfaceit.backend.usage.QuotaExceededException;
import io.csfaceit.backend.usage.UsageKind;
import io.csfaceit.backend.usage.UsageService;
import io.csfaceit.backend.usage.UsageService.Reservation;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Links a signed-in player's CS2 matchmaking history to the site, shows the link and removes it
 * ({@code /api/v1/cs2/link}). The player gives two things from Steam's page of their game's codes: the authentication
 * code, which lets the site read their history, and the sharing code of one of their recent matches, where the walk
 * starts. Both are checked with one call to Steam ({@link SteamShareCodeClient}) before anything is stored: Steam answers
 * that call only for a right pair. Then the link is stored ({@link Cs2Links#save}), the authentication code sealed
 * ({@link AuthCodeCipher}), and the walk ({@link Cs2ChainJob}) brings the match of the given code and every newer one.
 *
 * <p>The authentication code is a secret: it is read from the request, used for the Steam call and sealed, and it never
 * reaches a log line, an exception message or an answer. The request's own object hides it from {@code toString}.
 *
 * <p>Only a session links, for its own user. Each attempt that Steam is asked about is one of
 * {@link UsageKind#CS2_LINK} of the user's day, refused ones included, which bounds how often a code can be guessed;
 * an attempt Steam could not answer gives its place back.
 */
@Service
public class Cs2LinkService {

    public static final String CS2_DISABLED = "CS2_DISABLED";
    public static final String CS2_NOT_LINKED = "CS2_NOT_LINKED";
    public static final String CS2_AUTH_CODE_REFUSED = "CS2_AUTH_CODE_REFUSED";
    public static final String CS2_SHARE_CODE_REFUSED = "CS2_SHARE_CODE_REFUSED";
    public static final String CS2_STEAM_UNAVAILABLE = "CS2_STEAM_UNAVAILABLE";

    private static final String VALIDATION_ERROR = "VALIDATION_ERROR";
    private static final String FORBIDDEN = "FORBIDDEN";

    /** The shape of the authentication code Steam shows: four, five and four letters or digits. */
    private static final Pattern AUTH_CODE = Pattern.compile("^[A-Za-z0-9]{4}-[A-Za-z0-9]{5}-[A-Za-z0-9]{4}$");

    private static final Logger log = LoggerFactory.getLogger(Cs2LinkService.class);

    /**
     * A refusal whose status the shared error handler has no exception for: 422 (Steam refused one of the codes) and 503
     * (Steam could not be asked). {@link Cs2LinkController} answers it in the usual error shape.
     */
    public static final class Refused extends RuntimeException {

        private final HttpStatus status;
        private final String code;

        Refused(HttpStatus status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }

        public HttpStatus getStatus() {
            return status;
        }

        public String getCode() {
            return code;
        }
    }

    /** What a link request did: {@code created} is false when it replaced the user's earlier link. */
    public record Linked(boolean created, View link) {
    }

    private final Cs2Properties properties;
    private final AuthCodeCipher cipher;
    private final SteamShareCodeClient steam;
    private final Cs2Links links;
    private final UsageService usage;
    private final Clock clock;

    public Cs2LinkService(Cs2Properties properties, AuthCodeCipher cipher, SteamShareCodeClient steam, Cs2Links links,
                          UsageService usage, Clock clock) {
        this.properties = properties;
        this.cipher = cipher;
        this.steam = steam;
        this.links = links;
        this.usage = usage;
        this.clock = clock;
        if (properties.enabled()) {
            log.info("CS2 matchmaking is on: links are checked with Steam and walked every {}",
                    properties.sync().interval());
        } else {
            log.info("CS2 matchmaking is off: {} not set", missingSettings());
        }
    }

    /** Whether the feature is on (see {@link Cs2Properties#enabled}). */
    public boolean enabled() {
        return properties.enabled();
    }

    /**
     * The link of the user.
     *
     * @throws NotFoundException {@code CS2_NOT_LINKED}
     */
    public View get(Actor actor) {
        long userId = requireUser(actor).id();
        return links.find(userId)
                .orElseThrow(() -> new NotFoundException(CS2_NOT_LINKED, "No CS2 account is linked"));
    }

    /**
     * Links the user's CS2 matchmaking history, or links it again with new codes: the codes are checked with one call to
     * Steam, then stored, and the walk brings the match of {@code shareCode} first.
     *
     * @throws BadRequestException {@code VALIDATION_ERROR}: a code does not have the shape of one
     * @throws QuotaExceededException {@code CS2_LINK_LIMIT_REACHED}: no attempt left today
     * @throws Refused 422 {@code CS2_AUTH_CODE_REFUSED} or {@code CS2_SHARE_CODE_REFUSED}, 503
     *         {@code CS2_STEAM_UNAVAILABLE}; nothing is stored
     */
    public Linked link(Actor actor, String authCode, String shareCode) {
        SignedInUser user = requireUser(actor);
        List<String> problems = new ArrayList<>();
        if (authCode == null || !AUTH_CODE.matcher(authCode).matches()) {
            problems.add("authCode must be the authentication code Steam shows for CS2 match history: four, five and "
                    + "four letters or digits, separated by dashes");
        }
        if (!ShareCode.isWellFormed(shareCode)) {
            problems.add("shareCode must be a match sharing code: CSGO and five groups of five letters or digits, "
                    + "separated by dashes");
        }
        if (!problems.isEmpty()) {
            throw new BadRequestException(VALIDATION_ERROR, String.join("; ", problems));
        }
        String steamId = user.steamId();
        if (steamId == null || steamId.isBlank()) {
            throw new ForbiddenException(FORBIDDEN,
                    "Your account has no SteamID, so the site cannot read a CS2 history for it: sign in with Steam");
        }

        Reservation place = usage.reserve(actor, UsageKind.CS2_LINK);
        Answer answer = steam.nextCode(steamId, authCode, shareCode);
        switch (answer.outcome()) {
            case NEXT, NONE -> {
                Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
                boolean created = links.save(user.id(), cipher.seal(user.id(), authCode), shareCode, now);
                log.info("User {} {} a CS2 account", user.id(), created ? "linked" : "linked again");
                return new Linked(created, new View(Cs2Links.State.ACTIVE, now, now));
            }
            case AUTH_CODE_REFUSED -> {
                log.info("Refused user {}: {}", user.id(), CS2_AUTH_CODE_REFUSED);
                throw new Refused(HttpStatus.UNPROCESSABLE_ENTITY, CS2_AUTH_CODE_REFUSED,
                        "Steam did not accept the authentication code: copy it again from Steam's page of your CS2 "
                                + "match history codes, or make a new one there");
            }
            case SHARE_CODE_REFUSED -> {
                log.info("Refused user {}: {}", user.id(), CS2_SHARE_CODE_REFUSED);
                throw new Refused(HttpStatus.UNPROCESSABLE_ENTITY, CS2_SHARE_CODE_REFUSED,
                        "Steam did not accept the match sharing code for this account: give the code of one of your "
                                + "own recent matches, from the same page of Steam");
            }
            default -> {
                // Nothing was learned of the codes: the attempt does not count.
                usage.release(place);
                log.warn("Could not check the CS2 link of user {}: Steam is not available ({})", user.id(),
                        answer.outcome());
                throw new Refused(HttpStatus.SERVICE_UNAVAILABLE, CS2_STEAM_UNAVAILABLE,
                        "Steam could not be asked to check the codes; try again in a few minutes");
            }
        }
    }

    /** Removes the user's link and its code, if there is one. The matches it brought stay. */
    public void unlink(Actor actor) {
        long userId = requireUser(actor).id();
        links.delete(userId);
        log.info("User {} removed their CS2 link", userId);
    }

    /**
     * The signed-in user the request is for. The admin key is nobody and has no Steam account, so it is refused the way
     * the endpoints of a player's own things refuse it.
     */
    private static SignedInUser requireUser(Actor actor) {
        if (actor.user() == null) {
            log.info("Refused the {}: {}", actor.kind(), FORBIDDEN);
            throw new ForbiddenException(FORBIDDEN,
                    "The admin key has no Steam account of its own: a CS2 account is linked by a signed-in player");
        }
        return actor.user();
    }

    /** The names of the settings that are missing, for the line that says the feature is off. Never a value. */
    private String missingSettings() {
        List<String> missing = new ArrayList<>();
        if (!Cs2Properties.isSet(properties.steamApiKey())) {
            missing.add("STEAM_WEB_API_KEY");
        }
        if (!Cs2Properties.isSet(properties.bridgeUrl())) {
            missing.add("CS2_BRIDGE_URL");
        }
        if (!Cs2Properties.isSet(properties.linkSecret())) {
            missing.add("CS2_LINK_SECRET");
        }
        return String.join(", ", missing);
    }
}
