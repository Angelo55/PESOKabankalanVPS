const jwt = require('jsonwebtoken');
const { normalizeRole, getRoleLabel, getPermissions, ROLE_KEYS } = require('./rbac');

const requireAdmin = (req, res, next) => {
    // Look for the token in the cookies or the Authorization header
    const token = req.cookies?.jobTrackerToken || (req.headers.authorization && req.headers.authorization.split(' ')[1]);

    if (!token) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized. No token provided.' });
    }

    try {
        // Decode the token using your secret key
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key');
        const role = normalizeRole(decoded.role);
        
        // 🚨 STRICT ISOLATION: Reject if the role is not 'admin'
        if (role !== ROLE_KEYS.SUPER_ADMINISTRATOR) {
            return res.status(403).json({ status: 'error', message: 'Forbidden. Super Administrator privileges required.' });
        }
        
        // Pass the user ID and role to the next function
        req.userId = decoded.userId;
        req.userRole = role;
        req.roleLabel = getRoleLabel(role);
        req.permissions = getPermissions(role);
        next();
    } catch (error) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized. Invalid or expired token.' });
    }
};

module.exports = requireAdmin;
