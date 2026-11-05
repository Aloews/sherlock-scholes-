use std::{env, error::Error, io, net::SocketAddr};

pub struct Config {
    pub bind_addr: SocketAddr,
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn Error>> {
        let raw = env::var("FD_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_owned());
        let bind_addr = parse_bind_addr(&raw)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;

        Ok(Self { bind_addr })
    }
}

fn parse_bind_addr(value: &str) -> Result<SocketAddr, std::net::AddrParseError> {
    value.parse()
}

#[cfg(test)]
mod tests {
    use super::parse_bind_addr;
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    #[test]
    fn parses_explicit_bind_address() {
        assert_eq!(
            parse_bind_addr("127.0.0.1:9090").expect("valid socket address"),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 9090)
        );
    }

    #[test]
    fn rejects_invalid_bind_address() {
        assert!(parse_bind_addr("not-an-address").is_err());
    }
}
