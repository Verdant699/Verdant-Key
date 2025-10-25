const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: 'kantotinkomamamo',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true if using HTTPS
        maxAge: 30 * 60 * 1000 // 30 minutes
    }
}));

// Manual admin credentials
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: 'admin123'
};

// Initialize SQLite Database
const db = new sqlite3.Database('./keys.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initializeDatabase();
    }
});

// Create tables
function initializeDatabase() {
    // Create keys table
    const createKeysTable = `CREATE TABLE IF NOT EXISTS keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        keyType TEXT NOT NULL,
        expiration_date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        isActive BOOLEAN DEFAULT 1,
        used BOOLEAN DEFAULT 0,
        used_by TEXT,
        used_at DATETIME
    )`;
    
    db.run(createKeysTable, (err) => {
        if (err) {
            console.error('Error creating keys table:', err.message);
        } else {
            console.log('Keys table ready.');
        }
    });

    // Create stats table
    const createStatsTable = `CREATE TABLE IF NOT EXISTS key_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_generated INTEGER DEFAULT 0,
        active_keys INTEGER DEFAULT 0,
        revoked_keys INTEGER DEFAULT 0
    )`;
    
    db.run(createStatsTable, (err) => {
        if (err) {
            console.error('Error creating stats table:', err.message);
        } else {
            console.log('Stats table ready.');
            initializeStats();
        }
    });

    // Create activity log table
    const createActivityTable = `CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        license_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;
    
    db.run(createActivityTable, (err) => {
        if (err) {
            console.error('Error creating activity table:', err.message);
        } else {
            console.log('Activity table ready.');
        }
    });
}

function initializeStats() {
    db.get("SELECT * FROM key_stats WHERE id = 1", (err, row) => {
        if (!row) {
            db.run("INSERT INTO key_stats (id, total_generated, active_keys, revoked_keys) VALUES (1, 0, 0, 0)");
        }
    });
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        // Reset session timer on activity
        req.session.touch();
        next();
    } else {
        res.status(401).json({ success: false, message: 'Authentication required' });
    }
}

// Login endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        req.session.authenticated = true;
        req.session.username = username;
        req.session.loginTime = new Date();
        
        // Log login activity
        db.run("INSERT INTO activity_log (action, details) VALUES (?, ?)", 
            ['LOGIN', `User ${username} logged in`]);
        
        res.json({ 
            success: true, 
            message: 'Login successful',
            user: { username }
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Invalid credentials' 
        });
    }
});

// Logout endpoint
app.get('/api/logout', (req, res) => {
    // Log logout activity
    if (req.session.username) {
        db.run("INSERT INTO activity_log (action, details) VALUES (?, ?)", 
            ['LOGOUT', `User ${req.session.username} logged out`]);
    }
    
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logout successful' });
    });
});

// Session check endpoint
app.get('/api/session', requireAuth, (req, res) => {
    res.json({ 
        success: true, 
        authenticated: true,
        user: { username: req.session.username },
        loginTime: req.session.loginTime
    });
});

// Key generation function
function generateKey(type, days = null) {
    const prefix = "VERDANT-KEY";
    let keyType, expirationDays;
    
    switch(type) {
        case 'hour':
            keyType = '1HOUR';
            expirationDays = 1/24;
            break;
        case 'day':
            keyType = '1DAY';
            expirationDays = 1;
            break;
        case 'week':
            keyType = '7DAYS';
            expirationDays = 7;
            break;
        case 'month':
            keyType = '30DAYS';
            expirationDays = 30;
            break;
        case 'permanent':
            keyType = 'LIFETIME';
            expirationDays = 36500;
            break;
        case 'custom':
            keyType = `${days}DAYS`;
            expirationDays = days;
            break;
        default:
            keyType = '1DAY';
            expirationDays = 1;
    }
    
    const uniqueId = uuidv4().substr(0, 8).toUpperCase();
    const key = `${prefix}-${keyType}-${uniqueId}`;
    
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + expirationDays);
    
    return {
        key: key,
        type: type,
        keyType: keyType,
        expiration_date: expirationDate.toISOString().split('T')[0]
    };
}

// Validation endpoint
app.post('/api/validate', (req, res) => {
    const { key, device_id } = req.body;
    
    console.log(`Validation attempt: ${key}, Device: ${device_id}`);
    
    if (!key || !device_id) {
        return res.json({
            success: false,
            valid: false,
            message: "Missing key or device ID"
        });
    }
    
    // Check key in database
    db.get("SELECT * FROM keys WHERE key = ?", [key], (err, row) => {
        if (err) {
            return res.json({
                success: false,
                valid: false,
                message: "Database error"
            });
        }
        
        if (!row) {
            return res.json({
                success: true,
                valid: false,
                message: "Invalid license key"
            });
        }
        
        if (!row.isActive) {
            return res.json({
                success: true,
                valid: false,
                message: "Key has been revoked"
            });
        }
        
        // Check expiration
        const currentDate = new Date().toISOString().split('T')[0];
        if (currentDate > row.expiration_date) {
            return res.json({
                success: true,
                valid: false,
                message: "License has expired"
            });
        }
        
        // Check if key already used on different device
        if (row.used && row.used_by !== device_id) {
            return res.json({
                success: true,
                valid: false,
                message: "Key already activated on another device"
            });
        }
        
        // Activate key if not used
        if (!row.used) {
            db.run(
                "UPDATE keys SET used = 1, used_by = ?, used_at = datetime('now') WHERE key = ?",
                [device_id, key],
                (err) => {
                    if (err) {
                        console.error('Error updating key usage:', err);
                    }
                }
            );
        }
        
        res.json({
            success: true,
            valid: true,
            message: "Access granted!",
            expiration_date: row.expiration_date,
            user_level: "premium",
            key_type: row.keyType
        });
    });
});

// Generate keys endpoint (protected)
app.post('/api/admin/generate', requireAuth, (req, res) => {
    const { type, quantity = 1, days = null } = req.body;
    
    const validTypes = ['hour', 'day', 'week', 'month', 'permanent', 'custom'];
    if (!validTypes.includes(type)) {
        return res.json({
            success: false,
            message: "Invalid key type"
        });
    }
    
    if (type === 'custom' && (!days || days < 1)) {
        return res.json({
            success: false,
            message: "Custom keys require days parameter"
        });
    }
    
    const generatedKeys = [];
    
    // Generate all keys first
    for (let i = 0; i < quantity; i++) {
        const newKey = generateKey(type, days);
        generatedKeys.push(newKey);
        
        // Insert into database
        db.run(
            `INSERT INTO keys (key, type, keyType, expiration_date) VALUES (?, ?, ?, ?)`,
            [newKey.key, newKey.type, newKey.keyType, newKey.expiration_date],
            (err) => {
                if (err) {
                    console.error('Error saving key:', err);
                }
            }
        );
    }
    
    // Update stats
    db.run(
        "UPDATE key_stats SET total_generated = total_generated + ?, active_keys = active_keys + ? WHERE id = 1",
        [quantity, quantity],
        (err) => {
            if (err) {
                console.error('Error updating stats:', err);
            }
            
            // Log generation activity
            db.run("INSERT INTO activity_log (action, details) VALUES (?, ?)", 
                ['KEY_GENERATED', `Generated ${quantity} ${type} keys`]);
            
            res.json({
                success: true,
                message: `Generated ${quantity} ${type} key(s)`,
                keys: generatedKeys
            });
        }
    );
});

// Revoke key endpoint (protected)
app.post('/api/admin/revoke', requireAuth, (req, res) => {
    const { key } = req.body;
    
    db.run(
        "UPDATE keys SET isActive = 0 WHERE key = ?",
        [key],
        function(err) {
            if (err) {
                return res.json({
                    success: false,
                    message: "Error revoking key"
                });
            }
            
            if (this.changes === 0) {
                return res.json({
                    success: false,
                    message: "Key not found"
                });
            }
            
            // Update stats
            db.run(
                "UPDATE key_stats SET revoked_keys = revoked_keys + 1, active_keys = active_keys - 1 WHERE id = 1",
                (err) => {
                    if (err) console.error('Error updating stats:', err);
                    
                    // Log revoke activity
                    db.run("INSERT INTO activity_log (action, details, license_key) VALUES (?, ?, ?)", 
                        ['KEY_REVOKED', 'License key revoked', key]);
                    
                    res.json({
                        success: true,
                        message: "Key revoked successfully"
                    });
                }
            );
        }
    );
});

// Get all keys endpoint (protected)
app.get('/api/admin/keys', requireAuth, (req, res) => {
    db.all("SELECT * FROM keys ORDER BY created_at DESC", (err, keys) => {
        if (err) {
            return res.json({
                success: false,
                message: "Database error"
            });
        }
        
        db.get("SELECT * FROM key_stats WHERE id = 1", (err, stats) => {
            const statsData = stats || { total_generated: 0, active_keys: 0, revoked_keys: 0 };
            
            const keyList = keys.map(key => ({
                key: key.key,
                type: key.type,
                keyType: key.keyType,
                expiration_date: key.expiration_date,
                created_at: key.created_at,
                isActive: Boolean(key.isActive),
                used: Boolean(key.used),
                used_by: key.used_by,
                used_at: key.used_at
            }));
            
            res.json({
                success: true,
                keys: keyList,
                stats: {
                    total_generated: statsData.total_generated,
                    active_keys: statsData.active_keys,
                    revoked_keys: statsData.revoked_keys
                }
            });
        });
    });
});

// Delete key endpoint (protected)
app.delete('/api/admin/keys/:key', requireAuth, (req, res) => {
    const { key } = req.params;
    
    db.get("SELECT isActive FROM keys WHERE key = ?", [key], (err, row) => {
        if (err || !row) {
            return res.json({
                success: false,
                message: "Key not found"
            });
        }
        
        const wasActive = Boolean(row.isActive);
        
        db.run("DELETE FROM keys WHERE key = ?", [key], function(err) {
            if (err) {
                return res.json({
                    success: false,
                    message: "Error deleting key"
                });
            }
            
            // Update stats
            let updateQuery = "UPDATE key_stats SET total_generated = total_generated - 1";
            if (wasActive) {
                updateQuery += ", active_keys = active_keys - 1";
            } else {
                updateQuery += ", revoked_keys = revoked_keys - 1";
            }
            updateQuery += " WHERE id = 1";
            
            db.run(updateQuery, (err) => {
                if (err) console.error('Error updating stats:', err);
                
                // Log delete activity
                db.run("INSERT INTO activity_log (action, details, license_key) VALUES (?, ?, ?)", 
                    ['KEY_DELETED', 'License key permanently deleted', key]);
                
                res.json({
                    success: true,
                    message: "Key deleted permanently"
                });
            });
        });
    });
});

// Get stats endpoint (protected)
app.get('/api/admin/stats', requireAuth, (req, res) => {
    db.get("SELECT * FROM key_stats WHERE id = 1", (err, stats) => {
        if (err) {
            return res.json({
                success: false,
                message: "Error fetching stats"
            });
        }
        
        // Get recent activity
        db.all("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10", (err, activity) => {
            res.json({
                success: true,
                stats: stats || { total_generated: 0, active_keys: 0, revoked_keys: 0 },
                activity: activity || []
            });
        });
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Verdant Key Management'
    });
});

// Serve login page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

// Serve dashboard (protected)
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Key management server running on port ${PORT}`);
    console.log(`🗄️  Using SQLite database: keys.db`);
    console.log(`🔑 Login: http://localhost:${PORT}/`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/admin`);
    console.log(`🔐 Default credentials: admin / admin123`);
});