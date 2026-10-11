-- WatchOver Database Schema + Demo Data
-- =====================================
-- Sanitized for public release (capstone repository).
-- All real user data, GPS history, and credentials have been removed.
-- The rows below are SYNTHETIC DEMO DATA so the system can be explored
-- without real hardware. The demo account is:
--
--     email:    demo@example.com
--     password: watchover-demo
--
-- Device demo password for all demo devices: 12345
--
-- MySQL dump 10.13  Distrib 8.0.45, for Linux (x86_64)
--
-- Host: localhost    Database: watchover
-- ------------------------------------------------------
-- Server version	8.0.45-0ubuntu0.24.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULT */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `device_status`
--

DROP TABLE IF EXISTS `device_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `device_status` (
  `device_id` varchar(50) NOT NULL,
  `current_latitude` decimal(10,7) DEFAULT NULL,
  `current_longitude` decimal(10,7) DEFAULT NULL,
  `battery_level` int DEFAULT NULL,
  `timestamp` datetime NOT NULL,
  `location_address` varchar(255) DEFAULT NULL,
  `last_known_address` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`device_id`),
  CONSTRAINT `fk_device_status_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `device_status` (DEMO DATA)
--

LOCK TABLES `device_status` WRITE;
/*!40000 ALTER TABLE `device_status` DISABLE KEYS */;
INSERT INTO `device_status` VALUES ('WatchOver_012998',14.6872096,121.0479404,85,'2026-03-14 16:46:27','Sample Street A','Sample Street A'),('WatchOver_115855',14.6548448,121.0335482,85,'2026-03-14 16:51:23','Sample Street B','Sample Street B');
/*!40000 ALTER TABLE `device_status` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `devices`
--

DROP TABLE IF EXISTS `devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `devices` (
  `device_id` varchar(50) NOT NULL,
  `device_password` varchar(255) NOT NULL,
  `device_name` varchar(100) NOT NULL,
  PRIMARY KEY (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `devices` (DEMO DATA)
--

LOCK TABLES `devices` WRITE;
/*!40000 ALTER TABLE `devices` DISABLE KEYS */;
INSERT INTO `devices` VALUES ('WatchOver_012998','12345','Demo Watch 1'),('WatchOver_115855','12345','Demo Watch 2'),('WatchOver_624545','12345','Demo Watch 3');
/*!40000 ALTER TABLE `devices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `geofences`
--

DROP TABLE IF EXISTS `geofences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `geofences` (
  `geofence_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `device_id` varchar(50) NOT NULL,
  `center_latitude` decimal(10,7) NOT NULL,
  `center_longitude` decimal(10,7) NOT NULL,
  `radius` int NOT NULL,
  PRIMARY KEY (`geofence_id`),
  KEY `idx_geofences_user` (`user_id`),
  KEY `idx_geofences_device` (`device_id`),
  CONSTRAINT `fk_geofences_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_geofences_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `geofences`
--

LOCK TABLES `geofences` WRITE;
/*!40000 ALTER TABLE `geofences` DISABLE KEYS */;
/*!40000 ALTER TABLE `geofences` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `gps_data`
--

DROP TABLE IF EXISTS `gps_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gps_data` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(50) NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `timestamp` datetime NOT NULL,
  `battery_level` int DEFAULT NULL,
  `location_address` varchar(255) DEFAULT NULL,
  `last_known_address` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_gps_device_time` (`device_id`,`timestamp`),
  CONSTRAINT `fk_gps_data_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `gps_data` (DEMO DATA)
--

LOCK TABLES `gps_data` WRITE;
/*!40000 ALTER TABLE `gps_data` DISABLE KEYS */;
INSERT INTO `gps_data` VALUES (1,'WatchOver_012998',14.6868600,121.0499330,'2026-03-14 16:45:53',85,'Sample Street A','Sample Street A'),(2,'WatchOver_012998',14.6866630,121.0496280,'2026-03-14 12:46:04',85,'Sample Street B','Sample Street B'),(3,'WatchOver_012998',14.6548448,121.0335482,'2026-03-11 01:46:11',85,'Sample Street C','Sample Street C'),(4,'WatchOver_012998',14.6874916,121.0470053,'2026-03-12 19:46:20',85,'Sample Street D','Sample Street D'),(5,'WatchOver_012998',14.6872096,121.0479404,'2026-03-13 16:48:27',85,'Sample Street E','Sample Street E'),(6,'WatchOver_115855',14.6872096,121.0479404,'2026-03-14 13:51:10',85,'Sample Street F','Sample Street F'),(7,'WatchOver_115855',14.6548448,121.0335482,'2026-03-12 16:51:23',85,'Sample Street G','Sample Street G');
/*!40000 ALTER TABLE `gps_data` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `push_subscriptions`
--

DROP TABLE IF EXISTS `push_subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `push_subscriptions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `endpoint` varchar(500) NOT NULL,
  `p256dh` varchar(255) NOT NULL,
  `auth` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `endpoint` (`endpoint`),
  KEY `idx_push_user` (`user_id`),
  CONSTRAINT `fk_push_subscriptions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `push_subscriptions`
--

LOCK TABLES `push_subscriptions` WRITE;
/*!40000 ALTER TABLE `push_subscriptions` DISABLE KEYS */;
/*!40000 ALTER TABLE `push_subscriptions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_devices`
--

DROP TABLE IF EXISTS `user_devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `device_id` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_device` (`user_id`,`device_id`),
  KEY `fk_user_devices_device` (`device_id`),
  CONSTRAINT `fk_user_devices_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_user_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_devices` (DEMO DATA)
--

LOCK TABLES `user_devices` WRITE;
/*!40000 ALTER TABLE `user_devices` DISABLE KEYS */;
INSERT INTO `user_devices` VALUES (1,1,'WatchOver_115855');
/*!40000 ALTER TABLE `user_devices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `is_verified` tinyint(1) NOT NULL DEFAULT '0',
  `verification_token` varchar(255) DEFAULT NULL,
  `token_expires` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reset_token` varchar(255) DEFAULT NULL,
  `reset_token_expires` datetime DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users` (DEMO DATA)
-- Demo login: demo@example.com / watchover-demo
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'demo@example.com','$2y$10$YDVGZqwtJgnnQWFYqxIls.brk9QyNkPo9oAlILANLvrNj/ymJcpE.',1,NULL,NULL,'2026-03-14 16:40:52',NULL,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'watchover'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULT=@OLD_CHARACTER_SET_RESULT */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-03-14 18:44:31
