/**
 * authMiddleware.js — JWT Route Protection Middleware
 * ═══════════════════════════════════════════════════
 * 
 * Three middleware functions for different protection levels:
 * 
 * 1. authenticateFarmer — Protects farmer-only routes (chat, feedback)
 *    Validates JWT with type='farmer', attaches farmer info to req.user
 * 
 * 2. authenticateAdmin — Protects admin-only routes (dashboard, review)
 *    Validates JWT with type='admin', attaches admin info to req.user
 * 
 * 3. authenticateAny — Protects routes accessible by both roles
 *    Validates any valid JWT, attaches user info to req.user
 * 
 * Usage:
 *   app.get('/api/conversations', authenticateFarmer, handler);
 *   app.get('/api/admin/metrics', authenticateAdmin, handler);
 * 
 * The token is expected in the Authorization header:
 *   Authorization: Bearer <jwt_token>
 */

import { verifyToken } from '../services/authService.js';
import { findFarmerById } from '../database.js';

/**
 * Extract JWT from the Authorization header.
 * Supports "Bearer <token>" format.
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  // Support "Bearer <token>" format
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Also accept raw token (for simpler testing)
  return authHeader;
}

/**
 * Middleware: Require a valid farmer JWT.
 * Attaches decoded farmer info to req.user
 */
export function authenticateFarmer(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in with your email or Google account.'
    });
  }

  const decoded = verifyToken(token);

  if (!decoded || decoded.type !== 'farmer') {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session. Please log in again.'
    });
  }

  // Attach user info to request for downstream handlers
  req.user = {
    id: decoded.id,
    type: 'farmer',
    email: decoded.email
  };

  next();
}

/**
 * Middleware: Require a valid admin JWT.
 * Optionally restrict to specific roles.
 * 
 * @param {string[]} allowedRoles - Optional. e.g., ['admin'] to restrict to full admins only
 */
export function authenticateAdmin(allowedRoles = null) {
  return (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required.'
      });
    }

    const decoded = verifyToken(token);

    if (!decoded || decoded.type !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    // Check role if specific roles are required
    if (allowedRoles && !allowedRoles.includes(decoded.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`
      });
    }

    req.user = {
      id: decoded.id,
      type: 'admin',
      role: decoded.role,
      email: decoded.email
    };

    next();
  };
}

/**
 * Middleware: Require any valid JWT (farmer or admin).
 * Useful for shared endpoints like health checks with user context.
 */
export function authenticateAny(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session. Please log in again.'
    });
  }

  req.user = {
    id: decoded.id,
    type: decoded.type,
    role: decoded.role || null
  };

  next();
}

/**
 * Middleware: Optional authentication.
 * If a valid token is present, attaches user info.
 * If no token, continues without user info (req.user = null).
 * Useful for public endpoints that behave differently when authenticated.
 */
export function optionalAuth(req, res, next) {
  const token = extractToken(req);

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = {
        id: decoded.id,
        type: decoded.type,
        role: decoded.role || null
      };
    }
  }

  next();
}
