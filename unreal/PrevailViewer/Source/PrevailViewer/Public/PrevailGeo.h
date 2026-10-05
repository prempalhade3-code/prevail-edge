#pragma once

#include "CoreMinimal.h"

/**
 * Same local frame as frontend/src/lib/geo.ts and scene.json.
 * x = east metres, z = -north metres. Unreal: X = east cm, Y = scene z cm, Z = up.
 */
namespace PrevailGeo
{
	inline constexpr double OriginLat = 12.94;
	inline constexpr double OriginLon = 77.686;
	inline constexpr double MetersPerDegLat = 111320.0;

	inline double MetersPerDegLon()
	{
		return MetersPerDegLat * FMath::Cos(FMath::DegreesToRadians(OriginLat));
	}

	inline void LatLonToScene(double Lat, double Lon, double& OutX, double& OutZ)
	{
		OutX = (Lon - OriginLon) * MetersPerDegLon();
		OutZ = -(Lat - OriginLat) * MetersPerDegLat;
	}

	inline FVector SceneToUnreal(double SceneX, double SceneZ, double HeightCm = 40.0)
	{
		return FVector(SceneX * 100.0, SceneZ * 100.0, HeightCm);
	}

	inline FVector LatLonToUnreal(double Lat, double Lon, double HeightCm = 40.0)
	{
		double X = 0.0;
		double Z = 0.0;
		LatLonToScene(Lat, Lon, X, Z);
		return SceneToUnreal(X, Z, HeightCm);
	}

	/** Compass clockwise from north. Unreal yaw 0 = +X east, Y = scene z = -north. */
	inline float HeadingToYaw(double HeadingDeg)
	{
		return static_cast<float>(HeadingDeg - 90.0);
	}

	inline float SceneYawToUnreal(double YawRad)
	{
		return static_cast<float>(-FMath::RadiansToDegrees(YawRad));
	}
}
