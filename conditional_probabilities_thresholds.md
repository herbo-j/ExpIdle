# Conditional Probabilities: optimal thresholds

Optimal values of the thresholds S (for X, drives r) and T (for Z, drives z) in every phase of
`CT/ConditionalProbabilities.js`, together with the resulting **net effect**: the expected change
per tick and per unit of r₁ (resp. z₁), including the ticks that are rejected by the threshold.
This is the quantity the in-game net-effect lines estimate over the last 100 ticks.

The exponent milestones (r^1.1, q^1.13, z^1.01) do not change any optimum, they only change how r, q and z enter ρ̇.

## S (threshold for X)

r only changes in ticks where X > S:

```
ṙ = factor · r₁   if X > S,   0 otherwise
```

### Before Y: factor = X, X ~ U(a, b)

```
net(S) = (b² − S²) / (2(b − a))
```

Maximal at **S = 0** for every interval containing 0, with net(0) = b² / (2(b − a)).

| Phase | Unlock | X | Optimal S | Net effect at optimum |
|---|---|---|---|---|
| Base | – | U(−1, 1) | 0 | 0.25 |
| X interval lv 1 | e20 | U(−6, 4) | 0 | 0.8 |
| X interval lv 2 | e35 | U(−18, 12) | 0 | 2.4 |
| X interval lv 3 | e50 | U(−54, 36) | 0 | 7.2 |

### With Y: factor = X + Y, X ~ U(−2, 1), Y ~ N(f(X), 1)

The threshold still applies to X. With f(x) = c·x + d, the conditional mean is
E[X + Y | X = x] = m(x) = a·x + b with a = c + 1 and b = d. Then

```
net(S) = (a(1 − S²)/2 + b(1 − S)) / 3
```

Maximal where m(S) = 0, i.e. **S = −b/a**: accept a tick exactly when its conditional mean is
positive. The optimal net effect is (a + b)² / (6a).

Without a threshold (S = −2), E[X + Y] = −a/2 + b < 0 in all phases, so a bad S makes r shrink
(down to the floor at 0).

| Phase | Unlock | f(x) | m(x) | E[X + Y] unconditioned | Optimal S | Net effect at optimum |
|---|---|---|---|---|---|---|
| Y | e150 | 36x + 18 | 37x + 18 | −0.5 | ≈ −0.4865 (= −18/37) | ≈ 13.626 (= 3025/222) |
| f lv 1 | e250 | 72x + 32 | 73x + 32 | −4.5 | ≈ −0.4384 (= −32/73) | ≈ 25.171 (= 11025/438) |
| f lv 2 | e350 | 160x + 60 | 161x + 60 | −20.5 | ≈ −0.3727 (= −60/161) | ≈ 50.560 (= 48841/966) |

While Y is active, the X interval milestone has no effect (X is always U(−2, 1)).

## T (threshold for Z)

Unlocked at e100. z only changes in ticks where Z > T:

```
ż = Z · z₁   if Z > T,   0 otherwise,     Z ~ N(μ, σ²),  μ = −1,  σ = z₂ = 2^(level + 1)
```

With k = (T − μ)/σ, φ the standard normal density and Φ its CDF:

```
net(T) = μ(1 − Φ(k)) + σ·φ(k)
d net / dT = −T · density_Z(T)
```

So **T = 0 is optimal for every σ** (every z₂ level).

| z₂ level | σ | Optimal T | Net effect at optimum |
|---|---|---|---|
| 0 | 2 | 0 | ≈ 0.3956 |
| 1 | 4 | 0 | ≈ 1.1454 |
| 2 | 8 | 0 | ≈ 2.7164 |
| 3 | 16 | 0 | ≈ 5.8955 |
| 4 | 32 | 0 | ≈ 12.272 |
| (σ = 1, for reference) | 1 | 0 | ≈ 0.0833 |
| large | σ | 0 | ≈ σ/√(2π) − 1/2 + 1/(2σ√(2π)) |

Each z₂ level therefore multiplies ż by slightly more than 2, approaching 2 for large σ.

For a fixed T and large σ:

```
net(T) ≈ σ/√(2π) + μ/2 + (μ² − T²) / (2σ√(2π))
```

so a non-optimal T costs about T² / (2σ√(2π)), i.e. a relative loss of about T² / (2σ²).
The choice of T only matters noticeably while T is comparable to σ (the first few z₂ levels).

## x (when to press the W button, active only)

Unlocked at e500. With the W milestone q only grows while the player has pressed the button:

```
q̇ = q₁ q₂ Ŵ,   Ŵ = W after pressing the button, 0 otherwise (also offline, so q stalls)
W ~ N(w(X), σ²),  σ = 10³,  w(x) = 75σ (1 / (1 + e^(−100(x − 0.1))) − 1/2)
```

W is drawn every 50 ticks (5 s) with the X of that tick. Only that X is shown (on the button), not W.
Pressing is worth it exactly when E[W | X] = w(X) > 0, i.e. **press when X > 0.1**. With
A = 75σ, k = 100, m = 0.1, X ~ U(a, b) and pressing whenever X > c:

```
net(c) = A ((ln(1 + e^(k(b − m))) − ln(1 + e^(k(c − m)))) / k − (b − c)/2) / (b − a)
```

| X | Net effect at c = 0.1 (per tick of an accepted draw) |
|---|---|
| U(−2, 1) (with Y, the normal case) | ≈ 11077 |
| U(−54, 36) (Y refunded, X interval lv 3) | ≈ 14953 |

The button shows X rounded down to 2 decimals, so the shown value never overstates X: pressing
whenever the button shows **x ≥ 0.10** is exactly the optimal rule X ≥ 0.1, with no rounding loss.

The scale 75 keeps W almost never negative when pressing correctly: already at X = 0.11,
w(X) ≈ 17.3σ, so P(W < 0) ≈ 10⁻⁶⁷. The noise σ only matters for X within a few hundredths of 0.1.

Ŵ is 0 in the draw tick itself and until the player reacts, so a player who presses right after
the draw gets 49/50 of it (≈ 10855, `w_press_delay_ticks` in the sim). Refunding Y for the wider X
interval raises W by only about 35 %, but loses far more on r (net 7.2 instead of 50.6).
