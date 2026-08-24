# Local HTTPS certificates

These files are **not** in git (`*.pem` is ignored).

For LAN / iPhone testing with geolocation, generate certs with [mkcert](https://github.com/FiloSottile/mkcert):

```bash
brew install mkcert
mkcert -install
cd certs
mkcert -cert-file local.pem -key-file local-key.pem \
  localhost 127.0.0.1 ::1 apollo.local 10.174.1.186
```

Copy the mkcert root CA if you need to trust it on a phone (`mkcert -CAROOT`).

Then:

```bash
python3 serve-https.py --port 8765
```
