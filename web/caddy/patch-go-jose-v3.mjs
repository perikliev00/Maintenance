/**
 * Apply CVE-2026-116587 RSA modulus bounds to go-jose v3.0.5 jwk.go
 * (same checks as go-jose v4.1.6; upstream has no v3 release).
 *
 * Usage: node patch-go-jose-v3.mjs /path/to/jwk.go
 */
import fs from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node patch-go-jose-v3.mjs <jwk.go>");
  process.exit(2);
}

let text = fs.readFileSync(path, "utf8");

const publicOld = `func (key rawJSONWebKey) rsaPublicKey() (*rsa.PublicKey, error) {
	if key.N == nil || key.E == nil {
		return nil, fmt.Errorf("go-jose/go-jose: invalid RSA key, missing n/e values")
	}

	return &rsa.PublicKey{
		N: key.N.bigInt(),
		E: key.E.toInt(),
	}, nil
}`;

const publicNew = `// MaxRSAModulusBits is the largest RSA modulus size, in bits, that will be
// accepted when parsing a JWK. Applications that need larger keys can raise
// this limit before any parsing occurs.
var MaxRSAModulusBits = 4096

func (key rawJSONWebKey) rsaPublicKey() (*rsa.PublicKey, error) {
	if key.N == nil || key.E == nil {
		return nil, fmt.Errorf("go-jose/go-jose: invalid RSA key, missing n/e values")
	}

	n := key.N.bigInt()
	if n.BitLen() > MaxRSAModulusBits {
		return nil, fmt.Errorf("go-jose/go-jose: invalid RSA key, modulus too large")
	}

	return &rsa.PublicKey{
		N: n,
		E: key.E.toInt(),
	}, nil
}`;

const privOld = `	rv := &rsa.PrivateKey{
		PublicKey: rsa.PublicKey{
			N: key.N.bigInt(),
			E: key.E.toInt(),
		},
		D: key.D.bigInt(),
		Primes: []*big.Int{
			key.P.bigInt(),
			key.Q.bigInt(),
		},
	}`;

const privNew = `	n := key.N.bigInt()
	if n.BitLen() > MaxRSAModulusBits {
		return nil, fmt.Errorf("go-jose/go-jose: invalid RSA key, modulus too large")
	}

	p, q := key.P.bigInt(), key.Q.bigInt()
	if p.BitLen()+q.BitLen() > n.BitLen()+1 || new(big.Int).Mul(p, q).Cmp(n) != 0 {
		return nil, errors.New("go-jose/go-jose: invalid RSA private key, p * q != n")
	}

	rv := &rsa.PrivateKey{
		PublicKey: rsa.PublicKey{
			N: n,
			E: key.E.toInt(),
		},
		D: key.D.bigInt(),
		Primes: []*big.Int{p, q},
	}`;

if (!text.includes(publicOld)) {
  console.error("rsaPublicKey block not found");
  process.exit(1);
}
if (!text.includes(privOld)) {
  console.error("rsaPrivateKey block not found");
  process.exit(1);
}

text = text.replace(publicOld, publicNew).replace(privOld, privNew);
fs.writeFileSync(path, text);
console.log("patched", path);
