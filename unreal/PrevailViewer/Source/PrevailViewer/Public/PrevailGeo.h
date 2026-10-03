#pragma once

#include "CoreMinimal.h"

/**
 * Same local frame as frontend/src/lib/geo.ts and sim/network/build_city.py.
 * Unreal units are centimetres. X = east, Y = north, Z = up.
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

	inline FVector LatLonToUnreal(double Lat, double Lon, double HeightCm = 40.0)
	{
		const double EastM = (Lon - OriginLon) * MetersPerDegLon();
		const double NorthM = (Lat - OriginLat) * MetersPerDegLat;
		return FVector(EastM * 100.0, NorthM * 100.0, HeightCm);
	}

	/** Compass degrees clockwise from north → Unreal yaw (0 = +X east). */
	inline float HeadingToYaw(double HeadingDeg)
	{
		return static_cast<float>(90.0 - HeadingDeg);
	}
}
