use std::{env, error::Error, io, net::SocketAddr};

pub struct Config {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub migration_database_url: Option<String>,
    pub max_connections: u32,
    pub allowed_origin: String,
    pub run_migrations: bool,
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn Error>> {
        let port = env::var("PORT").unwrap_or_else(|_| "8080".to_owned());
        let bind_default = format!("0.0.0.0:{port}");
        let bind_addr = env::var("FD_BIND_ADDR")
            .unwrap_or(bind_default)
            .parse::<SocketAddr>()
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        let database_url = resolve_database_url(
            env::var("FD_DATABASE_URL").ok(),
            env::var("POSTGRES_URL").ok(),
            env::var("POSTGRES_URL_NON_POOLING").ok(),
        )?;
        let allowed_origin = required("FD_ALLOWED_ORIGIN")?;
        let run_migrations = env::var("FD_RUN_MIGRATIONS")
            .unwrap_or_else(|_| "false".to_owned())
            .parse::<bool>()
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        let migration_database_url = env::var("FD_MIGRATION_DATABASE_URL").ok();
        if run_migrations && migration_database_url.is_none() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "FD_MIGRATION_DATABASE_URL is required when FD_RUN_MIGRATIONS=true",
            )
            .into());
        }
        let max_connections = env::var("FD_MAX_CONNECTIONS")
            .unwrap_or_else(|_| "2".to_owned())
            .parse::<u32>()
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        if max_connections == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "FD_MAX_CONNECTIONS must be positive",
            )
            .into());
        }

        Ok(Self {
            bind_addr,
            database_url,
            migration_database_url,
            max_connections,
            allowed_origin,
            run_migrations,
        })
    }
}

fn resolve_database_url(
    primary: Option<String>,
    pooled: Option<String>,
    direct: Option<String>,
) -> Result<String, io::Error> {
    primary
        .filter(|value| !value.trim().is_empty())
        .or_else(|| pooled.filter(|value| !value.trim().is_empty()))
        .or_else(|| direct.filter(|value| !value.trim().is_empty()))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "FD_DATABASE_URL, POSTGRES_URL, or POSTGRES_URL_NON_POOLING is required",
            )
        })
}

fn required(name: &str) -> Result<String, io::Error> {
    env::var(name).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("required environment variable {name} is missing"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{required, resolve_database_url};

    #[test]
    fn explicit_fd_database_url_takes_precedence() {
        let value = resolve_database_url(
            Some("fd-url".into()),
            Some("pooled-url".into()),
            Some("direct-url".into()),
        )
        .unwrap();
        assert_eq!(value, "fd-url");
    }

    #[test]
    fn pooled_supabase_url_precedes_direct_url() {
        let value =
            resolve_database_url(None, Some("pooled-url".into()), Some("direct-url".into()))
                .unwrap();
        assert_eq!(value, "pooled-url");
    }

    #[test]
    fn direct_supabase_url_is_a_local_fallback() {
        let value = resolve_database_url(None, None, Some("direct-url".into())).unwrap();
        assert_eq!(value, "direct-url");
    }

    #[test]
    fn empty_database_urls_fail_closed() {
        assert!(resolve_database_url(Some(" ".into()), Some("".into()), None).is_err());
    }

    #[test]
    fn missing_required_setting_fails_closed() {
        let error = required("FD_TEST_SETTING_THAT_DOES_NOT_EXIST").unwrap_err();
        assert!(error.to_string().contains("required environment variable"));
    }
}
