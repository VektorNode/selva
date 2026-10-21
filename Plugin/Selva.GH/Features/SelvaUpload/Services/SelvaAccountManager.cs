#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>A signed-in instance, ready to call. Only <see cref="SelvaAccountManager" /> makes one.</summary>
public sealed class SelvaSession
{
    internal SelvaSession(string origin, string token, SelvaAccountRecord record)
    {
        Origin = origin;
        Token = token;
        Record = record;
    }

    public string Origin { get; }
    public string Token { get; }
    public SelvaAccountRecord Record { get; }
}

/// <summary>
///     The user's Selva sign-ins, one per instance origin, shared by every UI Bridge in the process.
///     Holds the keys; hands the web UI only <see cref="Snapshot" />, which never carries one.
///     Operations are serialised: a second one waits for the first, except <see cref="Cancel" />.
/// </summary>
public sealed class SelvaAccountManager
{
    private static readonly TimeSpan SignInTimeout = TimeSpan.FromMinutes(5);

    private readonly string _accountsPath;
    private readonly SelvaAccountsFile _file;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Func<HttpMessageHandler> _handlers;
    private readonly MemoryCredentialStore _memory = new();
    private readonly Func<DateTimeOffset> _now;
    private readonly Action<string> _openBrowser;
    private readonly ICredentialStore _osStore;
    private readonly object _stateLock = new();
    private readonly Dictionary<string, string> _tokens = new();
    private readonly string _userAgent;

    private bool _cancelRequested;
    private CancellationTokenSource? _inFlight;
    private string? _message;
    private bool _signingIn;

    /// <param name="openBrowser">Opens an https URL on the instance in the system browser.</param>
    public SelvaAccountManager(ICredentialStore osStore, string accountsPath, Func<HttpMessageHandler> handlers,
        string userAgent, Action<string> openBrowser, Func<DateTimeOffset>? now = null)
    {
        _osStore = osStore;
        _accountsPath = accountsPath;
        _handlers = handlers;
        _userAgent = userAgent;
        _openBrowser = openBrowser;
        _now = now ?? (() => DateTimeOffset.UtcNow);
        _file = SelvaAccountsFile.Load(accountsPath);
    }

    /// <summary>Raised after any change the account row shows; never under a lock.</summary>
    public event Action? Changed;

    public SelvaAccount Snapshot()
    {
        Session();
        lock (_stateLock)
        {
            var origin = _file.ActiveOrigin;
            var record = _file.Find(origin);
            var signedIn = origin != null && record?.Email != null && CachedOrStoredToken(origin) != null;

            var account = new SelvaAccount
            {
                Status = _signingIn ? "signingIn" : signedIn ? "signedIn" : "signedOut",
                Origin = origin,
                Host = origin != null ? SelvaOrigin.DisplayHost(origin) : null,
                KnownOrigins = _file.Accounts.Select(a => a.Origin).ToList(),
                ExtraScopes = new List<string>(),
                Storage = record?.Storage == "memory" ? "memory" : _osStore.Kind,
                Message = _message
            };

            if (signedIn && !_signingIn)
            {
                account.User = new SelvaUser { Email = record!.Email!, DisplayName = record.DisplayName };
                account.Org = record.OrgId != null
                    ? new SelvaOrg { Id = record.OrgId, Name = record.OrgName ?? record.OrgId }
                    : null;
                account.ExpiresAt = record.ExpiresAt;
                account.ExtraScopes = ExtraScopes(record.Scopes);
            }

            return account;
        }
    }

    /// <summary>Null when signed out. A token past its expiry is dropped here.</summary>
    public SelvaSession? Session()
    {
        string? expired = null;
        SelvaSession? session = null;
        lock (_stateLock)
        {
            var origin = _file.ActiveOrigin;
            var record = _file.Find(origin);
            var token = origin != null ? CachedOrStoredToken(origin) : null;
            if (origin != null && record?.Email != null && token != null)
            {
                if (IsExpired(record))
                {
                    expired = origin;
                }
                else
                {
                    session = new SelvaSession(origin, token, record);
                }
            }
        }

        if (expired != null)
        {
            Forget(expired, $"Your sign-in to {SelvaOrigin.DisplayHost(expired)} ran out. Sign in again.");
        }

        return session;
    }

    public async Task ConnectAsync(string input, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!SelvaOrigin.TryNormalize(input, out var origin, out var error))
            {
                SetMessage(error);
                return;
            }

            try
            {
                using var anonymous = new SelvaApiClient(origin!, null, _userAgent, _handlers());
                await ReadMetadataAsync(anonymous, cancellationToken).ConfigureAwait(false);
            }
            catch (SelvaApiException ex)
            {
                SetMessage(ex.Message);
                return;
            }

            lock (_stateLock)
            {
                _file.ActiveOrigin = origin;
                if (_file.Find(origin) == null)
                {
                    _file.Upsert(new SelvaAccountRecord { Origin = origin! });
                }

                _message = null;
                SaveFile();
            }

            RaiseChanged();
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    ///     Authorization code with PKCE through the system browser and a loopback redirect
    ///     (RFC 8252). The browser keeps the user's single sign-on and password manager, and the
    ///     plugin never sees a password.
    /// </summary>
    public async Task SignInAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        var origin = ActiveOrigin();
        using var inFlight = BeginInFlight(cancellationToken);
        try
        {
            if (origin == null)
            {
                SetMessage("Enter your Selva address first.");
                return;
            }

            lock (_stateLock)
            {
                _signingIn = true;
                _message = null;
            }

            RaiseChanged();

            inFlight.CancelAfter(SignInTimeout);
            using var anonymous = new SelvaApiClient(origin, null, _userAgent, _handlers());
            var metadata = await ReadMetadataAsync(anonymous, inFlight.Token).ConfigureAwait(false);

            var verifier = Pkce.NewVerifier();
            var state = Pkce.NewState();
            using var listener = LoopbackCallbackListener.Start();
            var url = OAuthCallback.AuthorizeUrl(metadata.AuthorizationEndpoint, listener.RedirectUri,
                Pkce.Challenge(verifier), state, origin);
            if (!SelvaOrigin.IsOnOrigin(url, origin))
            {
                throw new SelvaApiException("The sign-in address isn't on this Selva instance.");
            }

            try
            {
                _openBrowser(url);
            }
            catch (Exception ex) when (!(ex is OperationCanceledException))
            {
                throw new SelvaApiException($"Couldn't open your browser: {ex.Message}");
            }

            var callback = await listener.WaitAsync(state, origin, inFlight.Token).ConfigureAwait(false);
            if (callback.Kind != OAuthCallbackKind.Code)
            {
                SetMessage(callback.Error);
                return;
            }

            var token = await anonymous.RedeemCodeAsync(metadata.TokenEndpoint, callback.Code!,
                listener.RedirectUri, verifier, inFlight.Token).ConfigureAwait(false);
            await CompleteAsync(origin, token, inFlight.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            bool cancelled;
            lock (_stateLock)
            {
                cancelled = _cancelRequested || cancellationToken.IsCancellationRequested;
            }

            SetMessage(cancelled ? "Sign-in was cancelled." : "Sign-in timed out. Try again.");
        }
        catch (SelvaApiException ex)
        {
            SetMessage(ex.Message);
        }
        finally
        {
            EndInFlight();
            lock (_stateLock)
            {
                _signingIn = false;
            }

            RaiseChanged();
            _gate.Release();
        }
    }

    /// <summary>
    ///     For places the browser flow can't reach. The key comes from a plugin dialog, never the
    ///     web UI. <paramref name="origin" /> is the instance the dialog named: the key goes there or
    ///     nowhere, even if another page switched the active instance while the dialog was open.
    /// </summary>
    public async Task UseApiKeyAsync(string? origin, string key, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            key = key.Trim();
            if (origin == null)
            {
                SetMessage("Enter your Selva address first.");
                return;
            }

            if (origin != ActiveOrigin())
            {
                SetMessage("The Selva address changed while the key dialog was open. Try again.");
                return;
            }

            if (!ApiKeyFormat.IsWellFormed(key))
            {
                SetMessage("That isn't a Selva key. Keys start with selva_ and are 42 characters long.");
                return;
            }

            await CompleteAsync(origin, key, cancellationToken).ConfigureAwait(false);
            SetMessage(null);
        }
        catch (SelvaApiException ex)
        {
            SetMessage(ex.Status == 401 ? "Selva didn't accept this key. It may have expired or been revoked." : ex.Message);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    ///     Revokes the key at Selva, then forgets it. The key is forgotten even when Selva can't be
    ///     reached, and the message says it stays valid until it expires or is revoked.
    /// </summary>
    public async Task SignOutAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var origin = ActiveOrigin();
            var token = origin != null ? CachedOrStoredTokenLocked(origin) : null;
            if (origin == null || token == null)
            {
                return;
            }

            string? message = null;
            try
            {
                using var client = new SelvaApiClient(origin, token, _userAgent, _handlers());
                await client.DeleteAsync("/api/v1/me/token", cancellationToken).ConfigureAwait(false);
            }
            catch (SelvaApiException ex) when (!ex.InvalidToken)
            {
                message = "Signed out here, but Selva couldn't be told: the key stays valid until it expires " +
                          $"or is revoked at {origin}/team/tokens.";
            }

            Forget(origin, message);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Stops a sign-in waiting for the browser.</summary>
    public void Cancel()
    {
        lock (_stateLock)
        {
            _cancelRequested = true;
            _inFlight?.Cancel();
        }
    }

    /// <summary>Drops the key for this origin without telling Selva: it already refused it.</summary>
    public void Forget(string origin, string? message)
    {
        lock (_stateLock)
        {
            _tokens.Remove(origin);
            _memory.Delete(origin);
            _osStore.Delete(origin);

            var record = _file.Find(origin);
            if (record != null)
            {
                _file.Upsert(new SelvaAccountRecord { Origin = origin });
            }

            _message = message;
            SaveFile();
        }

        RaiseChanged();
    }

    // ============================================================================
    // Internals
    // ============================================================================

    private async Task CompleteAsync(string origin, string token, CancellationToken cancellationToken)
    {
        using var client = new SelvaApiClient(origin, token, _userAgent, _handlers());
        var me = await client.GetJsonAsync("/api/v1/me", cancellationToken).ConfigureAwait(false);

        var email = (string?)me["email"];
        var orgId = (string?)me["actingOrgId"];
        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(orgId))
        {
            throw new SelvaApiException("This key isn't tied to a user in an organization.");
        }

        string? orgName = null;
        try
        {
            var org = await client.GetJsonAsync($"/api/v1/orgs/{Uri.EscapeDataString(orgId)}", cancellationToken)
                .ConfigureAwait(false);
            orgName = (string?)org["name"];
        }
        catch (SelvaApiException ex) when (!ex.InvalidToken)
        {
            // The org id stands in for its name.
        }

        var stored = _osStore.TrySave(origin, token);
        if (!stored)
        {
            _memory.TrySave(origin, token);
        }

        lock (_stateLock)
        {
            _tokens[origin] = token;
            _file.ActiveOrigin = origin;
            _file.Upsert(new SelvaAccountRecord
            {
                Origin = origin,
                Email = email,
                UserId = (string?)me["userId"],
                DisplayName = (string?)me["displayName"],
                OrgId = orgId,
                OrgName = orgName,
                ExpiresAt = (string?)me["apiToken"]?["expiresAt"],
                Scopes = (me["apiToken"]?["scopes"] as JArray)?.Select(s => (string?)s).OfType<string>().ToList() ??
                         new List<string>(),
                Storage = stored ? _osStore.Kind : "memory"
            });
            SaveFile();
        }
    }

    private static async Task<AuthServerMetadata> ReadMetadataAsync(SelvaApiClient client,
        CancellationToken cancellationToken)
    {
        JObject json;
        try
        {
            json = await client.GetJsonAsync(AuthServerMetadata.WellKnownPath, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (SelvaApiException ex) when (ex.Status == 404)
        {
            throw new SelvaApiException("This address doesn't answer like a Selva instance.", 404);
        }

        if (!AuthServerMetadata.TryParse(json.ToString(), client.Origin, out var metadata, out var error))
        {
            throw new SelvaApiException(error!);
        }

        return metadata!;
    }

    // Scopes look like `upload:all` or `write:project:<id>`; only the action matters here.
    private static List<string> ExtraScopes(IEnumerable<string> scopes)
    {
        return scopes.Where(s =>
        {
            var action = s.Split(':')[0];
            return action != "read" && action != "upload";
        }).ToList();
    }

    private bool IsExpired(SelvaAccountRecord record)
    {
        return record.ExpiresAt != null &&
               DateTimeOffset.TryParse(record.ExpiresAt, CultureInfo.InvariantCulture,
                   DateTimeStyles.AssumeUniversal, out var expiresAt) &&
               expiresAt <= _now();
    }

    private string? ActiveOrigin()
    {
        lock (_stateLock)
        {
            return _file.ActiveOrigin;
        }
    }

    private string? CachedOrStoredTokenLocked(string origin)
    {
        lock (_stateLock)
        {
            return CachedOrStoredToken(origin);
        }
    }

    // The OS store is read once per origin; after that the key stays in memory until Rhino closes.
    private string? CachedOrStoredToken(string origin)
    {
        if (_tokens.TryGetValue(origin, out var token))
        {
            return token;
        }

        token = _memory.Load(origin) ?? _osStore.Load(origin);
        if (token != null)
        {
            _tokens[origin] = token;
        }

        return token;
    }

    private CancellationTokenSource BeginInFlight(CancellationToken cancellationToken)
    {
        lock (_stateLock)
        {
            _cancelRequested = false;
            _inFlight = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            return _inFlight;
        }
    }

    private void EndInFlight()
    {
        lock (_stateLock)
        {
            _inFlight = null;
        }
    }

    private void SetMessage(string? message)
    {
        lock (_stateLock)
        {
            _message = message;
        }

        RaiseChanged();
    }

    private void SaveFile()
    {
        try
        {
            _file.Save(_accountsPath);
        }
        catch (Exception ex) when (ex is System.IO.IOException || ex is UnauthorizedAccessException)
        {
            // Only convenience is lost: the instance list starts empty next session.
        }
    }

    private void RaiseChanged()
    {
        Changed?.Invoke();
    }
}
