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
        let database_url = required("FD_DATABASE_URL")?;
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
    use super::required;

    #[test]
    fn missing_required_setting_fails_closed() {
        let error = required("FD_TEST_SETTING_THAT_DOES_NOT_EXIST").unwrap_err();
        assert!(error.to_string().contains("required environment variable"));
    }
}
