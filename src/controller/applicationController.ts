import { Application, ApplicationStatus } from "../models/applicationModel.js";
import { type Response } from "express";
import { type AuthedRequest, auth } from "../middleware/auth.js";
import mongoose from "mongoose";

export async function createApplication(req: AuthedRequest, res: Response) {
  try {
    const {
      company,
      position,
      status,
      location = "",
      salary = 0,
      currency = "$",
      jobUrl = "",
      description = "",
      appliedAt = null,
      notes = "",
    } = req.body;

    if (!req.userId) {
      return res.status(401).json({ message: "User Not authenticated" });
    }

    if (!company || !position)
      return res
        .status(400)
        .json({ message: "Company and position are required" });
    if (status && !ApplicationStatus.includes(status))
      return res.status(400).json({ message: "Invalid Status" });

    const app = await Application.create({
      userId: new mongoose.Types.ObjectId(req.userId),
      company,
      position,
      status: status || "applied",
      location,
      salary,
      currency,
      jobUrl,
      description,
      appliedAt: appliedAt ? new Date(appliedAt) : null,
      notes,
    });

    return res
      .status(201)
      .json({ app, message: "Application created successfully" });
  } catch (error) {
    console.error(`Error Message: ${error}`);
    return res.status(500).json({ message: "Error creating application" });
  }
}

export async function getApplication(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: "User Not authenticated" });
    }

    const apps = await Application.find({
      userId: new mongoose.Types.ObjectId(req.userId),
    }).sort({
      createdAt: -1,
    });

    if (apps.length === 0) {
      return res.status(200).json({
        apps: [],
        message:
          "No applications found. Start by creating your first job application!",
      });
    }

    return res.status(200).json({ apps });
  } catch (error) {
    return res.status(500).json({ message: "Application retrieve failed" });
  }
}

export async function editApplication(req: AuthedRequest, res: Response) {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!req.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (updates.status && !ApplicationStatus.includes(updates.status)) {
      return res.status(400).json({ message: "Invalid Status" });
    }

    const app = await Application.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(id),
        userId: new mongoose.Types.ObjectId(req.userId),
      },
      { $set: updates },
      { returnDocument: "after" },
    );

    if (!app) return res.status(404).json({ message: "Not Found" });

    return res.status(200).json({ app, message: "Updated Successfully" });
  } catch (e) {
    console.error(`Error message ${e}`);
    return res.status(500).json({ message: "Error Updating" });
  }
}

export async function deleteApplication(req: AuthedRequest, res: Response) {
  try {
    const { id } = req.params;

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!req.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const deleted = await Application.findOneAndDelete({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(req.userId),
    });

    if (!deleted) return res.status(404).json({ message: "Not Found" });

    return res.status(200).json({ message: "Deleted" });
  } catch (e) {
    console.error(`Error Message: ${e}`);
    return res.status(500).json({ message: "Error Deleting" });
  }
}
