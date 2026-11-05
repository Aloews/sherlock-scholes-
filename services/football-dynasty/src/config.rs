use std::{env, error::Error, io, net::SocketAddr};

pub struct Config {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub supabase_url: String,
    pub supabase_anon_key: String,
    pub allowed_origin: String,
    pub run_migrations: bool,
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn Error>> {
        let bind_addr = env::var("FD_BIND_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_owned())
            .parse::<SocketAddr>()
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        let database_url = required("FD_DATABASE_URL")?;
        let supabase_url = required("SUPABASE_URL")?;
        let supabase_anon_key = required("SUPABASE_ANON_KEY")?;
        let allowed_origin = required("FD_ALLOWED_ORIGIN")?;
        let run_migrations = env::var("FD_RUN_MIGRATIONS")
            .unwrap_or_else(|_| "false".to_owned())
            .parse::<bool>()
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;

        Ok(Self {
            bind_addr,
            database_url,
            supabase_url,
            supabase_anon_key,
            allowed_origin,
            run_migrations,
        })
    }
}

fn required(name: &str) -> Result<String, io::Error> {
    env::var(name).map_err(|_| io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("required environment variable {name} is missing"),
    ))
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
